import type { CPMessage } from '../shared/types'

export class MessageBridge {
  static send(message: CPMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response: unknown) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else {
            resolve(response)
          }
        })
      } catch (e) { reject(e) }
    })
  }
}
