import { useReducer, useState } from 'react'
import { initialState, reducer } from './reducer.js'
import { RegistrationScreen } from './screen.js'
import { createSubmitter } from './submit.js'

// SCR-1 — the reducer wired to the screen. Submit runs the shared checks and the IF-2 save;
// focus moves to the first field to fix, never to the page body.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [submit] = useState(() => createSubmitter({ dispatch, focus: (field) => document.getElementById(field)?.focus() }))

  return (
    <RegistrationScreen
      state={state}
      onChange={(field, value) => dispatch({ type: 'change', field, value })}
      onSubmit={() => void submit(state.values)}
    />
  )
}
