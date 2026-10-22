import { flushSync } from 'react-dom'
import { useEffect, useMemo, useReducer, useRef } from 'react'
import { focusTargetFor, titleFor } from './effects.js'
import { initialState, reducer } from './reducer.js'
import { focusField, submitRegistration } from './required.js'
import { RegistrationScreen } from './Screen.js'
import { createSubmit } from './submit.js'

// SCR-1 — the registration screen as the kiosk runs it: the AD-7 reducer, the one submit
// path to IF-2, and the title and focus that follow each transition.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const submit = useMemo(() => createSubmit(dispatch), [])
  const previous = useRef(state.status)

  useEffect(() => {
    document.title = titleFor(state.status)
    const target = focusTargetFor(previous.current, state)
    previous.current = state.status
    if (target) document.getElementById(target)?.focus()
  }, [state])

  return (
    <RegistrationScreen
      state={state}
      onChange={(field, value) => dispatch({ type: 'change', field, value })}
      onSubmit={() => {
        // Render the errors before moving focus, so the focused field already reads its message (ST-3).
        if (submitRegistration(state.values, (action) => flushSync(() => dispatch(action)), focusField)) return
        void submit(state)
      }}
      onReset={() => dispatch({ type: 'reset' })}
    />
  )
}
