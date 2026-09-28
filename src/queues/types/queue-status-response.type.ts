export interface QueueStatusResponse {
  queueId: string;
  entryId: string;
  queueNumber: string;
  status: string;
  peopleAhead: number;
  estimatedWaitMinutes: number;
  currentlyServing: string | null;
}
