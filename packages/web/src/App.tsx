import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { focusTargetFor, titleFor } from './effects.js'
import { initialState, reducer } from './reducer.js'
import { RegistrationScreen } from './Screen.js'
import { createSubmit } from './submit.js'

// SCR-1 — the registration screen as the kiosk runs it: the AD-7 reducer, the one submit
// path to IF-2, the title and focus that follow each transition, and the one announcement
// that tells a screen reader the form was cleared for the next visitor (ST-5).
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const submit = useMemo(() => createSubmit(dispatch), [])
  const previous = useRef(state.status)
  const [announcement, setAnnouncement] = useState('')

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
      onChange={(field, value) => {
        setAnnouncement('')
        dispatch({ type: 'change', field, value })
      }}
      onSubmit={() => {
        setAnnouncement('')
        void submit(state)
      }}
      onReset={() => {
        setAnnouncement('Form cleared for the next visitor')
        dispatch({ type: 'reset' })
      }}
    />
  )
}
