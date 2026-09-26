import type {
  CircuitBreaker,
  CircuitMetrics,
  CircuitState
} from './circuit-breaker'

export interface RegistrySnapshot {
  circuits: CircuitMetrics[]
  summary: {
    total: number
    closed: number
    open: number
    halfOpen: number
  }
  timestamp: string
}

class CircuitRegistry {
  private circuits = new Map<string, CircuitBreaker>()

  register(circuit: CircuitBreaker): void {
    this.circuits.set(circuit.name, circuit)
  }

  unregister(name: string): boolean {
    return this.circuits.delete(name)
  }

  get(name: string): CircuitBreaker | undefined {
    return this.circuits.get(name)
  }

  has(name: string): boolean {
    return this.circuits.has(name)
  }

  getState(name: string): CircuitState | null {
    const circuit = this.circuits.get(name)
    return circuit ? circuit.getState() : null
  }

  getMetrics(name: string): CircuitMetrics | null {
    const circuit = this.circuits.get(name)
    return circuit ? circuit.getMetrics() : null
  }

  getAllMetrics(): CircuitMetrics[] {
    return Array.from(this.circuits.values()).map((circuit) =>
      circuit.getMetrics()
    )
  }

  getSnapshot(): RegistrySnapshot {
    const metrics = this.getAllMetrics()

    const summary = {
      total: metrics.length,
      closed: 0,
      open: 0,
      halfOpen: 0
    }

    metrics.forEach((m) => {
      switch (m.state) {
        case 'CLOSED':
          summary.closed++
          break
        case 'OPEN':
          summary.open++
          break
        case 'HALF_OPEN':
          summary.halfOpen++
          break
      }
    })

    return {
      circuits: metrics,
      summary,
      timestamp: new Date().toISOString()
    }
  }

  getStateMap(): Record<string, CircuitState> {
    const states: Record<string, CircuitState> = {}
    Array.from(this.circuits.entries()).forEach(([name, circuit]) => {
      states[name] = circuit.getState()
    })
    return states
  }

  hasOpenCircuits(): boolean {
    return Array.from(this.circuits.values()).some(
      (circuit) => circuit.getState() === 'OPEN'
    )
  }

  getOpenCircuitNames(): string[] {
    return Array.from(this.circuits.entries())
      .filter(([, circuit]) => circuit.getState() === 'OPEN')
      .map(([name]) => name)
  }

  resetAll(): void {
    Array.from(this.circuits.values()).forEach((circuit) => circuit.reset())
  }

  get size(): number {
    return this.circuits.size
  }

  clear(): void {
    this.circuits.clear()
  }
}

export const circuitRegistry = new CircuitRegistry()
