import { create } from 'zustand';
export interface AiActivity { id: string; file: string; nodeIds: string[]; page?: string; operation: string; mode: 'read' | 'write'; expiresAt: number; }
export const useAiPresence = create<{ activity: AiActivity[]; setActivity(activity: AiActivity[]): void }>(set => ({ activity: [], setActivity: activity => set({ activity }) }));
