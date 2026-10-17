import { useState } from 'react';
import Markdown from 'react-markdown';
type Question = {
  id: string;
  question: string;
  detail?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
};
export function DshQuestions({
  questions,
  disabled,
  submitting,
  submit,
}: {
  questions: Question[];
  disabled: boolean;
  submitting: boolean;
  submit: (response: unknown) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, { selected: string[]; custom: string }>>(
    {},
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled && !submitting)
          submit({ answers: questions.map((q) => ({ id: q.id, ...answers[q.id] })) });
      }}
    >
      {questions.map((q) => {
        const answer = answers[q.id] ?? { selected: [], custom: '' };
        return (
          <fieldset key={q.id} disabled={disabled || submitting}>
            <legend className={questions.length === 1 ? 'sr-only' : undefined}>{q.question}</legend>
            {q.detail && (
              <div className="question-detail">
                <Markdown>{q.detail}</Markdown>
              </div>
            )}
            {q.options?.map((o) => (
              <label className="choice" key={o.label}>
                <input
                  type={q.multiSelect ? 'checkbox' : 'radio'}
                  name={q.id}
                  checked={answer.selected.includes(o.label)}
                  onChange={() =>
                    setAnswers((old) => ({
                      ...old,
                      [q.id]: {
                        selected: q.multiSelect
                          ? answer.selected.includes(o.label)
                            ? answer.selected.filter((v) => v !== o.label)
                            : [...answer.selected, o.label]
                          : [o.label],
                        custom: q.multiSelect ? answer.custom : '',
                      },
                    }))
                  }
                />
                <span>
                  {o.label}
                  {o.description && <small>{o.description}</small>}
                </span>
              </label>
            ))}
            <label>
              {q.options?.length ? 'Other response' : 'Your response'}
              <textarea
                value={answer.custom}
                onChange={(e) =>
                  setAnswers((old) => ({
                    ...old,
                    [q.id]: {
                      selected: q.multiSelect ? answer.selected : [],
                      custom: e.target.value,
                    },
                  }))
                }
              />
            </label>
          </fieldset>
        );
      })}
      <button
        className="primary"
        disabled={
          disabled ||
          submitting ||
          questions.some((q) => !answers[q.id]?.selected.length && !answers[q.id]?.custom.trim())
        }
      >
        {submitting ? 'Sending response…' : 'Send response'}
      </button>
    </form>
  );
}
