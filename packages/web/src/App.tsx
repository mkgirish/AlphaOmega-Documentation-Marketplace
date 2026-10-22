import { useEffect, useReducer, useState } from 'react'
import { applyFocus } from './focus.js'
import { initialState, reducer } from './reducer.js'
import { RegistrationView } from './RegistrationView.js'
import { createSubmitter } from './submit.js'

// SCR-1 — wires the screen to its AD-7 reducer and the IF-2 client. Focus moves only when
// the status changes, never while the visitor types.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [submit] = useState(() => createSubmitter(dispatch))

  useEffect(() => {
    applyFocus(state, document)
  }, [state.status])

  return (
    <RegistrationView
      state={state}
      onChange={(field, value) => dispatch({ type: 'change', field, value })}
      onSubmit={() => void submit(state.values)}
    />
  )
}
