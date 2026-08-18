import { defineStore } from 'pinia'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
}

let nextId = 1

export const useToastStore = defineStore('toast', {
  state: () => ({
    items: [] as Toast[]
  }),
  actions: {
    push(message: string, kind: Toast['kind'] = 'info'): void {
      const id = nextId++
      this.items.push({ id, message, kind })
      setTimeout(() => this.dismiss(id), 4500)
    },
    success(message: string): void {
      this.push(message, 'success')
    },
    error(message: string): void {
      this.push(message, 'error')
    },
    dismiss(id: number): void {
      this.items = this.items.filter((t) => t.id !== id)
    }
  }
})