import { useReducer } from 'react'
import { screenCopy } from './copy.js'
import { initialState, reducer } from './reducer.js'

// SCR-1 — the registration screen: one card, four required fields and Submit, nothing else
// to reach. Native validation bubbles are off (noValidate); submission lands with its story.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)

  return (
    <main className="flex min-h-screen justify-center bg-page px-4 py-8 text-ink sm:items-center">
      {/* The px cap holds the card at 480px even when the kiosk raises the base font size. */}
      <div className="w-full max-w-[480px] min-w-0">
        <form
          aria-labelledby="screen-title"
          noValidate
          className="w-full max-w-[30rem] min-w-0 rounded-lg border border-line bg-card p-6 sm:p-8"
          onSubmit={(event) => event.preventDefault()}
        >
          <h1 id="screen-title" className="text-2xl font-semibold">
            {screenCopy.title}
          </h1>
          <p className="mt-2 text-base text-muted">{screenCopy.intro}</p>
          {screenCopy.fields.map((field, index) => (
            <div key={field.name} className="mt-5">
              <label htmlFor={field.name} className="block text-base font-medium">
                {field.label}
              </label>
              <input
                id={field.name}
                name={field.name}
                type={field.type}
                required
                autoFocus={index === 0}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={field.hint ? `${field.name}-hint` : undefined}
                value={state.values[field.name]}
                onChange={(event) => dispatch({ type: 'CHANGE', field: field.name, value: event.target.value })}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-line bg-card px-3 py-2 text-base text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              />
              {field.hint ? (
                <p id={`${field.name}-hint`} className="mt-1 text-sm text-muted">
                  {field.hint}
                </p>
              ) : null}
            </div>
          ))}
          <button
            id="submit"
            type="submit"
            className="mt-6 min-h-11 w-full rounded-md bg-accent px-4 py-2 text-base font-semibold text-on-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {screenCopy.submit}
          </button>
        </form>
      </div>
    </main>
  )
}
