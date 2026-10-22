// SCR-1 — the screen's own copy (not field rules: those and their messages come from CMP-2
// or verbatim from the API). Strings quoted by a story's acceptance criteria match it exactly.
export const copy = {
  formTitle: 'Visitor registration',
  confirmationTitle: 'Registration complete',
  thankYou: (firstName: string) => (firstName ? `Thank you, ${firstName}!` : 'Thank you!'),
  confirmationBody: 'Your visit is registered. Please let the receptionist know you have arrived.',
  registerAnother: 'Register another visitor',
  formCleared: 'Form cleared for the next visitor',
  summaryTitle: 'There is a problem',
  summaryFallback: 'Some details could not be accepted. Please check them and try again.',
  saveFailed: 'Your registration could not be saved. Please try again.',
} as const
