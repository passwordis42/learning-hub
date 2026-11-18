import json
import os
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from fc.managed_quota.bounds import FixedBound, production_bound
from fc.managed_quota.clock import BEIJING, BeijingClock
from fc.managed_quota.handler import handle
from fc.managed_quota.ledger import Ledger, LedgerError
from fc.managed_quota.store import SqliteLedgerStore, TablestoreLedgerStore, UnavailableStore
from fc.managed_quota.upstream import ClosedUpstream


def clock_at(moment):
    return BeijingClock(lambda: moment)


def ledger_at(path, moment, cap=1_000_000, **limits):
    return Ledger(SqliteLedgerStore(path), clock_at(moment), cap=cap, **limits)


def event(path, body, ip='203.0.113.8', session=None, key=None, xff='198.51.100.20'):
    headers = {'content-type': 'application/json', 'x-forwarded-for': xff}
    if session:
        headers['x-learning-session'] = session
    if key:
        headers['idempotency-key'] = key
    return {
        'version': 'v1',
        'rawPath': path,
        'body': json.dumps(body, ensure_ascii=False),
        'isBase64Encoded': False,
        'headers': headers,
        'requestContext': {'http': {'method': 'POST', 'path': path, 'sourceIp': ip, 'protocol': 'HTTP/1.1'}},
    }


def body_of(response):
    return json.loads(response['body'])


class QuotaTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = str(Path(self.directory.name) / 'ledger.sqlite')
        self.moment = datetime(2026, 11, 18, 23, 59, 59, tzinfo=BEIJING)
        self.ledger = ledger_at(self.path, self.moment, cap=1000)
        self.session = self.ledger.issue_session('203.0.113.8')
        self.ip = '203.0.113.8'

    def tearDown(self):
        self.directory.cleanup()

    def reserve(self, key, text='hello', amount=100, entry='ai'):
        return self.ledger.reserve(session_id=self.session, key=key, fingerprint=text, entry=entry, amount=amount, evidence_version='test', ip=self.ip)

    def test_bounds_are_closed_and_ignore_character_coefficient(self):
        os.environ['MANAGED_CHARS_PER_TOKEN'] = '4'
        try:
            with self.assertRaises(Exception):
                production_bound({'entry': 'ai', 'text': '你好' * 100})
            response = handle(event('/api/ai/requests', {'entry': 'ai', 'text': '你好'}, session=self.session, key='idempo-01'), store=SqliteLedgerStore(self.path), clock=clock_at(self.moment))
        finally:
            os.environ.pop('MANAGED_CHARS_PER_TOKEN', None)
        payload = body_of(response)
        self.assertEqual(payload['code'], 'UPPER_BOUND_UNPROVEN')
        self.assertEqual(payload['upstreamCalls'], 0)
        self.assertNotIn('百炼账户的自然日总额已经用完', payload['message'])
        self.assertIn('不是百炼账户的自然日总额', payload['message'])
        self.assertEqual(self.ledger.day('2026-11-18')['held_h'], 0)

    def test_unknown_fields_and_legacy_url_do_not_call_upstream(self):
        upstream = ClosedUpstream()
        response = handle(event('/api/ai/requests', {'entry': 'ai', 'text': '你好', 'model': 'qwen-plus', 'baseUrl': 'https://evil.example', 'budget': 1}, session=self.session, key='idempo-02'), store=SqliteLedgerStore(self.path), clock=clock_at(self.moment), upstream=upstream)
        self.assertEqual(body_of(response)['code'], 'bad_request')
        self.assertEqual(upstream.calls, 0)
        missed = handle(event('/api/tutor', {'entry': 'ai', 'text': '你好'}, session=self.session, key='idempo-03'), store=SqliteLedgerStore(self.path), clock=clock_at(self.moment), upstream=upstream)
        self.assertEqual(body_of(missed)['code'], 'not_ai')
        self.assertTrue(body_of(missed)['reading'])

    def test_critical_budget_and_threads(self):
        self.reserve('exact-full', amount=1000)
        self.ledger.commit_dispatch(session_id=self.session, key='exact-full', fingerprint='hello')
        self.ledger.uncertain(session_id=self.session, key='exact-full', fingerprint='hello', reason='finished')
        with self.assertRaises(LedgerError) as too_much:
            self.reserve('over', amount=1)
        self.assertEqual(too_much.exception.code, 'budget')
        self.assertEqual(self.ledger.day('2026-11-18')['held_h'], 1000)
        fresh = str(Path(self.directory.name) / 'race.sqlite')
        start = datetime(2026, 11, 18, 12, 0, tzinfo=BEIJING)
        wide = {'session_limit': 1000, 'ip_limit': 1000, 'site_limit': 1000, 'session_concurrency': 1000, 'ip_concurrency': 1000, 'site_concurrency': 1000}
        shared = ledger_at(fresh, start, cap=1000, **wide)
        session = shared.issue_session(self.ip)
        results = []
        barrier = threading.Barrier(100)

        def attempt(index):
            barrier.wait()
            book = ledger_at(fresh, start, cap=1000, **wide)
            try:
                book.reserve(session_id=session, key=f'race-{index}', fingerprint=f'payload-{index}', entry='game', amount=30, evidence_version='test', ip=self.ip)
                return 'ok'
            except LedgerError as error:
                return error.code

        threads = [threading.Thread(target=lambda i=i: results.append(attempt(i))) for i in range(100)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results.count('ok'), 33)
        self.assertEqual(ledger_at(fresh, start, cap=1000).day('2026-11-18')['held_h'], 990)
        self.assertLessEqual(ledger_at(fresh, start, cap=1000).day('2026-11-18')['held_h'], 1000)

    def test_idempotency_replay_conflict_and_expiry(self):
        first = self.reserve('same-key', text='one', amount=40)
        second = self.reserve('same-key', text='one', amount=40)
        self.assertTrue(second['replay'])
        self.assertEqual(self.ledger.day('2026-11-18')['held_h'], 40)
        with self.assertRaises(LedgerError) as conflict:
            self.reserve('same-key', text='two', amount=40)
        self.assertEqual(conflict.exception.code, 'idempotency_conflict')
        later = ledger_at(self.path, self.moment + timedelta(minutes=31), cap=1000)
        with self.assertRaises(LedgerError) as expired:
            later.reserve(session_id=self.session, key='same-key', fingerprint='one', entry='ai', amount=40, evidence_version='test', ip=self.ip)
        self.assertEqual(expired.exception.code, 'session_expired')
        self.assertEqual(first['reserved'], 40)

    def test_crash_windows_do_not_resend_or_refund(self):
        self.reserve('crash', amount=80)
        self.ledger.release(session_id=self.session, key='crash', fingerprint='hello')
        self.assertEqual(self.ledger.day('2026-11-18')['held_h'], 0)
        self.reserve('sent', text='body', amount=80)
        granted = self.ledger.commit_dispatch(session_id=self.session, key='sent', fingerprint='body')
        self.assertTrue(granted['send'])
        again = self.ledger.commit_dispatch(session_id=self.session, key='sent', fingerprint='body')
        self.assertFalse(again['send'])
        with self.assertRaises(LedgerError):
            self.ledger.release(session_id=self.session, key='sent', fingerprint='body')
        self.ledger.uncertain(session_id=self.session, key='sent', fingerprint='body', reason='timeout')
        self.assertEqual(self.ledger.day('2026-11-18')['held_h'], 80)
        self.assertEqual(self.ledger.day('2026-11-18')['settled_u'], 0)

    def test_usage_counts_prompt_plus_completion_once(self):
        self.reserve('usage', text='prompt', amount=200)
        self.ledger.commit_dispatch(session_id=self.session, key='usage', fingerprint='prompt')
        usage = {'prompt_tokens': 100, 'completion_tokens': 50, 'total_tokens': 150, 'completion_tokens_details': {'reasoning_tokens': 20}, 'prompt_tokens_details': {'cached_tokens': 40}}
        settled = self.ledger.settle(session_id=self.session, key='usage', fingerprint='prompt', usage=usage)
        self.assertEqual(settled['settled'], 150)
        replay = self.ledger.settle(session_id=self.session, key='usage', fingerprint='prompt', usage=usage)
        self.assertTrue(replay['replay'])
        self.assertEqual(self.ledger.day('2026-11-18')['settled_u'], 150)
        self.assertEqual(self.ledger.day('2026-11-18')['held_h'], 0)

    def test_missing_usage_and_cross_day_settlement(self):
        self.reserve('late', text='cross', amount=70)
        self.ledger.commit_dispatch(session_id=self.session, key='late', fingerprint='cross')
        self.ledger.uncertain(session_id=self.session, key='late', fingerprint='cross', reason='disconnect')
        next_day = ledger_at(self.path, datetime(2026, 11, 19, 0, 0, 1, tzinfo=BEIJING), cap=1000)
        outcome = next_day.settle(session_id=self.session, key='late', fingerprint='cross', usage={'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15})
        self.assertEqual(outcome['day'], '2026-11-18')
        self.assertEqual(next_day.day('2026-11-18')['settled_u'], 15)
        self.assertEqual(next_day.day('2026-11-19')['settled_u'], 0)
        self.assertEqual(next_day.day('2026-11-18')['held_h'], 0)

    def test_conservative_hold_is_not_released_by_time(self):
        self.reserve('hold', text='keep', amount=25)
        self.ledger.commit_dispatch(session_id=self.session, key='hold', fingerprint='keep')
        self.ledger.uncertain(session_id=self.session, key='hold', fingerprint='keep', reason='no_usage')
        moved = self.ledger.conservative(session_id=self.session, key='hold', fingerprint='keep')
        self.assertEqual(moved['state'], 'CONSERVATIVE_SETTLED')
        self.assertEqual(self.ledger.day('2026-11-18')['settled_u'], 25)
        self.assertEqual(self.ledger.day('2026-11-18')['held_h'], 0)

    def test_over_bound_fuses_and_does_not_clip(self):
        self.reserve('breach', text='too-much', amount=30)
        self.ledger.commit_dispatch(session_id=self.session, key='breach', fingerprint='too-much')
        breached = self.ledger.settle(session_id=self.session, key='breach', fingerprint='too-much', usage={'prompt_tokens': 40, 'completion_tokens': 5, 'total_tokens': 45})
        self.assertEqual(breached['state'], 'BREACH')
        self.assertEqual(breached['settled'], 45)
        self.assertTrue(self.ledger.day('2026-11-18')['breached'])
        with self.assertRaises(LedgerError) as fused:
            self.reserve('after', text='next', amount=1)
        self.assertEqual(fused.exception.code, 'fused')
        with self.assertRaises(LedgerError):
            self.ledger.reopen()

    def test_storage_failure_does_not_send(self):
        upstream = ClosedUpstream()
        response = handle(event('/api/ai/requests', {'entry': 'ai', 'text': '你好'}, session=self.session, key='idempo-04'), store=UnavailableStore(), clock=clock_at(self.moment), bounds=FixedBound(1, 1), upstream=upstream)
        self.assertEqual(body_of(response)['code'], 'storage_unavailable')
        self.assertEqual(upstream.calls, 0)

    def test_tablestore_adapter_is_not_a_pass(self):
        with self.assertRaises(Exception):
            TablestoreLedgerStore()

    def test_log_ttl_does_not_delete_tombstones(self):
        self.reserve('tomb', text='keep-me', amount=5)
        self.ledger.purge_logs(self.moment + timedelta(days=8))
        replay = self.reserve('tomb', text='keep-me', amount=5)
        self.assertTrue(replay['replay'])
        self.assertEqual(self.ledger.day('2026-11-18')['held_h'], 5)

    def test_xff_is_not_the_client(self):
        other = event('/api/ai/session', {}, ip='2001:db8::1', xff='203.0.113.8')
        created = handle(other, store=SqliteLedgerStore(self.path), clock=clock_at(self.moment))
        self.assertEqual(body_of(created)['code'], 'session')
        self.assertNotEqual(body_of(created)['sessionId'], '203.0.113.8')


if __name__ == '__main__':
    unittest.main()
