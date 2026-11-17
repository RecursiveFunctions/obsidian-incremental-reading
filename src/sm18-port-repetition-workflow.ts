import { predict, type SchedulerStatePrimitive } from "./sm18-scheduler";

export function runSteps(
  startState: SchedulerStatePrimitive,
  grades: number[],
): SchedulerStatePrimitive[] {
  const states: SchedulerStatePrimitive[] = [];
  let previous = startState;

  for (const grade of grades) {
    previous = predict(previous, grade);
    states.push(previous);
  }

  return states;
}
