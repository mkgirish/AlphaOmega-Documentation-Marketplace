import { useReducer } from 'react'
import { initialState, reducer, validate } from './reducer.js'

// SCR-1 — the registration screen. Scaffold baseline: enough structure to render and to
// exercise the reducer; the story builds out the full accessible form, submission and
// confirmation.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)

  return (
    <main>
      <h1>Visitor registration</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const errors = validate(state.values)
          if (Object.keys(errors).length > 0) {
            dispatch({ type: 'failed', errors })
            return
          }
          dispatch({ type: 'submit' })
        }}
      >
        <label>
          Full name
          <input
            value={state.values.fullName}
            onChange={(event) => dispatch({ type: 'change', field: 'fullName', value: event.target.value })}
          />
        </label>
        {state.errors.fullName ? <p role="alert">{state.errors.fullName}</p> : null}
        <label>
          Email
          <input
            type="email"
            value={state.values.email}
            onChange={(event) => dispatch({ type: 'change', field: 'email', value: event.target.value })}
          />
        </label>
        {state.errors.email ? <p role="alert">{state.errors.email}</p> : null}
        <button type="submit" disabled={state.submitting}>
          Register
        </button>
      </form>
    </main>
  )
}
