// AD-5 — the success and error envelopes every API response body is wrapped in.

/** AD-5 success envelope. */
export interface DataEnvelope<T> {
  data: T
}

/** AD-5 error envelope. */
export interface ErrorEnvelope {
  error: {
    message: string
    fields?: { path: string; message: string }[]
  }
}

export const envelope = <T>(data: T): DataEnvelope<T> => ({ data })

export const errorEnvelope = (message: string, fields?: { path: string; message: string }[]): ErrorEnvelope => ({
  error: fields === undefined ? { message } : { message, fields },
})
