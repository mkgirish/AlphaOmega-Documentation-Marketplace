import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { announcementFor, focusTargetFor, titleFor } from './effects.js'
import { initialState, reducer } from './reducer.js'
import { RegistrationScreen } from './Screen.js'
import { createSubmit } from './submit.js'

// SCR-1 — the registration screen as the kiosk runs it: the AD-7 reducer, the one submit
// path to IF-2, and the title, focus and announcement that follow each transition.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const submit = useMemo(() => createSubmit(dispatch), [])
  const previous = useRef(state.status)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    document.title = titleFor(state.status)
    const target = focusTargetFor(previous.current, state)
    const said = announcementFor(previous.current, state)
    previous.current = state.status
    if (target) document.getElementById(target)?.focus()
    if (said !== null) setAnnouncement(said)
  }, [state])

  return (
    <RegistrationScreen
      state={state}
      announcement={announcement}
      onChange={(field, value) => dispatch({ type: 'change', field, value })}
      onSubmit={() => void submit(state)}
      onReset={() => dispatch({ type: 'reset' })}
    />
  )
}
