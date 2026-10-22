import { useEffect, useMemo, useReducer, useRef } from 'react'
import { applyFocus } from './focus.js'
import { initialState, reducer } from './reducer.js'
import { RegistrationScreen } from './RegistrationScreen.js'
import { createSubmit } from './submit.js'

// SCR-1 — the registration screen as the kiosk runs it: the AD-7 reducer, one request per
// Submit, and focus moved to wherever the transition leaves the visitor.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const submit = useMemo(() => createSubmit(dispatch), [])
  const previous = useRef(state)

  useEffect(() => {
    applyFocus(previous.current, state, document)
    previous.current = state
  }, [state])

  return (
    <RegistrationScreen
      state={state}
      onChange={(field, value) => dispatch({ type: 'change', field, value })}
      onSubmit={() => void submit(state.values)}
      onReset={() => dispatch({ type: 'reset' })}
    />
  )
}
