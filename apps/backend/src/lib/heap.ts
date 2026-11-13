/**
 * Binärer Min-Heap auf typisierten Arrays für Dijkstra über Graphen mit
 * Millionen Knoten. Einträge werden nicht aktualisiert, sondern erneut
 * eingefügt («lazy deletion»); veraltete Einträge verwirft der Aufrufer.
 */
export class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private n = 0;

  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  push(key: number, val: number): void {
    if (this.n === this.keys.length) this.grow();
    const { keys, vals } = this;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** Kleinster Schlüssel (nur gültig, wenn size > 0). */
  peekKey(): number {
    return this.keys[0];
  }

  /** Entfernt das kleinste Element und gibt dessen Wert zurück; der Schlüssel steht danach in `lastKey`. */
  lastKey = 0;
  pop(): number {
    const { keys, vals } = this;
    const top = vals[0];
    this.lastKey = keys[0];
    const n = --this.n;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }

  private grow(): void {
    const keys = new Float64Array(this.keys.length * 2);
    keys.set(this.keys);
    this.keys = keys;
    const vals = new Int32Array(this.vals.length * 2);
    vals.set(this.vals);
    this.vals = vals;
  }
}
