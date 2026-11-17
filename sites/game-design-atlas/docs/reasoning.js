import { cleanReasoning, hasPractice } from './study-progress.js?v=guided-3';
import { mountFollowup } from './followup.js';

const fields = ['judgment', 'evidence', 'verification'];

export function mountReasoning(root, week, activity, previous, save, escape) {
  let answer = cleanReasoning(previous);

  function render() {
    const locked = Boolean(answer.submitted);
    root.innerHTML = '<div class="example-panel"><h4>' + escape(activity.title) + '</h4><p>' + escape(activity.scenario) + '</p></div>'
      + '<form class="reasoning-form"><label for="reason-judgment">' + escape(activity.prompts[0]) + '</label>'
      + '<textarea id="reason-judgment" name="judgment" maxlength="2000" rows="3" ' + (locked ? 'readonly' : 'required') + '>' + escape(answer.judgment) + '</textarea>'
      + '<label for="reason-evidence">' + escape(activity.prompts[1]) + '</label>'
      + '<textarea id="reason-evidence" name="evidence" maxlength="2000" rows="3" ' + (locked ? 'readonly' : 'required') + '>' + escape(answer.evidence) + '</textarea>'
      + '<label for="reason-verification">什么新证据会让你改变判断？</label>'
      + '<textarea id="reason-verification" name="verification" maxlength="2000" rows="3" ' + (locked ? 'readonly' : 'required') + '>' + escape(answer.verification) + '</textarea>'
      + '<div class="form-actions">' + (locked ? '<span class="quiet">✓ 首次判断已保存</span>' : '<button class="primary-button" type="submit">提交我的判断</button>') + '</div><p data-reason-status role="status"></p></form>'
      + (locked ? '<div class="practice-check"><h4>用三个标准核对你的推理</h4><ul>'
        + activity.checks.map((item) => '<li>' + escape(item) + '</li>').join('')
        + '</ul></div><details class="study-details"><summary>查看一种可辩护的思路</summary><div class="sample-answer"><p>' + escape(activity.sample) + '</p></div></details>'
        + '<details class="study-details"><summary>继续想两个问题</summary><div><ol>'
        + activity.followups.map((item) => '<li>' + escape(item) + '</li>').join('')
        + '</ol></div></details><details class="study-details"><summary>用我的首答请 AI 追问</summary><div data-reason-ai></div></details>'
        + '<label for="reason-reflection" class="study-input-label">对照或追问后的复盘</label><textarea id="reason-reflection" rows="3" maxlength="2000" placeholder="我保留或改变了什么判断？为什么？">' + escape(answer.reflection) + '</textarea>' : '');
    bind();
  }

  function bind() {
    const form = root.querySelector('.reasoning-form');
    const status = () => root.querySelector('[data-reason-status]');
    if (!answer.submitted) {
      form.addEventListener('input', (event) => {
        if (!fields.includes(event.target.name)) return;
        answer = { ...answer, [event.target.name]: event.target.value };
        save(answer);
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!fields.every((field) => hasPractice(answer[field]))) {
          status().textContent = '请分别写出你的判断、依据和可能改变判断的新证据。';
          return;
        }
        answer = { ...answer, submitted: true };
        save(answer);
        render();
        root.querySelector('.practice-check h4').setAttribute('tabindex', '-1');
        root.querySelector('.practice-check h4').focus();
      });
      return;
    }
    root.querySelector('#reason-reflection').addEventListener('input', (event) => {
      answer = { ...answer, reflection: event.target.value };
      save(answer);
    });
    mountFollowup(root.querySelector('[data-reason-ai]'), {
      week: week.id,
      title: '推理案例 · ' + activity.title,
      draft: answer.judgment,
      rationale: answer.evidence,
      evidence: answer.verification,
      context: [activity.scenario, ...activity.prompts].join('\n')
    });
  }

  render();
}
