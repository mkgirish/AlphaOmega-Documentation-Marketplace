import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { announcementAfter } from './announce.js'
import { focusTargetFor, titleFor } from './effects.js'
import { initialState, reducer, type FormAction } from './reducer.js'
import { RegistrationScreen } from './Screen.js'
import { createSubmit } from './submit.js'

// SCR-1 — the registration screen as the kiosk runs it: the AD-7 reducer, the one submit
// path to IF-2, and the title, focus and announcement that follow each transition.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [announcement, setAnnouncement] = useState('')
  const submit = useMemo(() => createSubmit(dispatch), [])
  const previous = useRef(state.status)

  useEffect(() => {
    document.title = titleFor(state.status)
    const target = focusTargetFor(previous.current, state)
    previous.current = state.status
    if (target) document.getElementById(target)?.focus()
  }, [state])

  const act = (action: FormAction) => {
    setAnnouncement(announcementAfter(state, action))
    dispatch(action)
  }

  return (
    <RegistrationScreen
      state={state}
      announcement={announcement}
      onChange={(field, value) => act({ type: 'change', field, value })}
      onSubmit={() => {
        setAnnouncement(announcementAfter(state, { type: 'submit' }))
        void submit(state)
      }}
      onReset={() => act({ type: 'reset' })}
    />
  )
}
