import { useEffect, useReducer, useState } from 'react'
import { postRegistration } from './api.js'
import { initialState, reducer } from './reducer.js'
import { Screen, syncScreen } from './Screen.js'
import { createSubmitter } from './submitter.js'

// SCR-1 — wires the screen to its reducer (AD-7) and to the one IF-2 request. Title and
// focus follow every change of state; while saving, focus stays where the visitor left it.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  // One submitter for the screen's lifetime: its in-flight guard must never be recreated mid-save.
  const [submit] = useState(() => createSubmitter(postRegistration, dispatch))

  // Keyed on the status alone: title and focus move on a transition, never on a keystroke.
  useEffect(() => syncScreen(state, document), [state.status])

  return <Screen state={state} dispatch={dispatch} onSubmit={() => void submit(state.values)} />
}
