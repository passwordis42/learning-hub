import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { lessonGlossary } from './data/lesson-glossary.js';
import { roadmapGlossary } from './data/roadmap-glossary.js';
import './lesson-term.css';

const glossary = { ...roadmapGlossary, ...lessonGlossary };
const escapeTerm = (term) => term.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&');
const inlineTerms = Object.keys(glossary).filter((term) => term !== '记录' && term !== '编码');
function makeTermPattern(terms) {
  return new RegExp('(' + terms.sort((left, right) => right.length - left.length).map(escapeTerm).join('|') + ')', 'g');
}
const termPattern = makeTermPattern(inlineTerms);

export function LessonTerm({ term, children, definition: lessonDefinition }) {
  const [open, setOpen] = useState(false);
  const control = useRef(null);
  const bubble = useRef(null);
  const closeButton = useRef(null);
  const id = useId();
  const definition = lessonDefinition ?? glossary[term];
  const label = typeof children === 'string' ? children : term;

  function close() {
    setOpen(false);
    control.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    const panel = bubble.current;
    const button = control.current;

    function place() {
      const anchor = button.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const margin = 12;
      const maxLeft = document.documentElement.clientWidth - panel.offsetWidth - margin;
      const maxTop = window.innerHeight - panel.offsetHeight - margin;
      const preferredTop = anchor.bottom + 8 <= maxTop ? anchor.bottom + 8 : anchor.top - panel.offsetHeight - 8;
      panel.style.left = Math.max(margin, Math.min(anchor.left, maxLeft)) + 'px';
      panel.style.top = Math.max(margin, Math.min(preferredTop, maxTop)) + 'px';
    }

    function onOutside(event) {
      if (!panel.contains(event.target) && !button.contains(event.target)) setOpen(false);
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        button.focus({ preventScroll: true });
      }
    }

    place();
    closeButton.current?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('focusin', onOutside);
    document.addEventListener('keydown', onKey);
    const sizeObserver = new ResizeObserver(place);
    sizeObserver.observe(panel);
    return () => {
      sizeObserver.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('focusin', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!definition) return children ?? term;

  return (
    <>
      <button ref={control} type="button" className="term-trigger" aria-label={label + ' · 查看解释'} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>{children ?? term}</button>
      {open && createPortal(
        <section ref={bubble} className="term-bubble" id={id} role="dialog" aria-labelledby={id + '-title'}>
          <header>
            <h2 id={id + '-title'}>{term}</h2>
            <button className="term-close" ref={closeButton} type="button" aria-label="关闭解释" onClick={close}><X size={17} /></button>
          </header>
          <p>{definition.plain}</p>
          <div className="term-example"><strong>看一个例子</strong>{definition.code ? <pre><code>{definition.example}</code></pre> : <p>{definition.example}</p>}</div>
          <details className="term-academic"><summary>正式定义与术语说明</summary><p>{definition.academic}</p></details>
        </section>,
        document.body,
      )}
    </>
  );
}

export function GlossaryText({ text, definitions }) {
  const dictionary = definitions ? { ...glossary, ...definitions } : glossary;
  const pattern = definitions ? makeTermPattern([...new Set([...inlineTerms, ...Object.keys(definitions)])]) : termPattern;
  const seen = new Set();
  return text.split(pattern).map((word, index) => {
    if (!Object.hasOwn(dictionary, word) || seen.has(word)) return word;
    seen.add(word);
    return <LessonTerm term={word} definition={dictionary[word]} key={index} />;
  });
}
