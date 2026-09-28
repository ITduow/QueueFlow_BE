export function formatQueueNumber(number: number): string {
  return `A${String(number).padStart(3, '0')}`;
}
