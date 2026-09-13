import data from '../data/performance.json';
import { performanceSnapshotSchema } from './performance-schema';
export const performance = performanceSnapshotSchema.parse(data);

import categoryData from '../data/performance-categories.json';
import { categorySnapshotsSchema, categoryForSource, type PerformanceCategory, type PerformanceBoardSnapshot } from './performance-categories';
export const performanceBoards: Record<PerformanceCategory, PerformanceBoardSnapshot> = {text:performance, ...Object.fromEntries(categorySnapshotsSchema.parse(categoryData).snapshots.map(snapshot=>[categoryForSource(snapshot.sourceId),snapshot]))} as Record<PerformanceCategory, PerformanceBoardSnapshot>;
