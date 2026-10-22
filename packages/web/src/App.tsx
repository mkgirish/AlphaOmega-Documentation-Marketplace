import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { formClearedAnnouncement } from './announcement.js'
import { focusTargetFor, titleFor } from './effects.js'
import { initialState, reducer } from './reducer.js'
import { RegistrationScreen } from './Screen.js'
import { createSubmit } from './submit.js'

// SCR-1 — the registration screen as the kiosk runs it: the AD-7 reducer, the one submit
// path to IF-2, and the title and focus that follow each transition.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const submit = useMemo(() => createSubmit(dispatch), [])
  const previous = useRef(state.status)
  const [cleared, setCleared] = useState(false)
  const announcement = cleared ? formClearedAnnouncement : state.status === 'confirmed' ? '' : undefined

  useEffect(() => {
    document.title = titleFor(state.status)
    const target = focusTargetFor(previous.current, state)
    previous.current = state.status
    if (target) document.getElementById(target)?.focus()
  }, [state])

  return (
    <RegistrationScreen
      state={state}
      announcement={announcement}
      onChange={(field, value) => dispatch({ type: 'change', field, value })}
      onSubmit={() => {
        setCleared(false)
        void submit(state)
      }}
      onReset={() => {
        setCleared(true)
        dispatch({ type: 'reset' })
      }}
    />
  )
}
