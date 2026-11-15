import { AppError } from './errors';
export type OperationPhase = 'processing' | 'committing';
export type OperationProgress = (count: number, phase?: OperationPhase) => void;
export function checkCancelled(signal?: AbortSignal): void { if (signal?.aborted) throw new AppError('operationCancelled'); }
export const yieldOperation = () => new Promise<void>(resolve => setTimeout(resolve, 0));
