import type { PipelineConfig } from "../config";
import type { Interpreter } from "../interpreter";
import { rulesInterpreter } from "./rules";

const INTERPRETERS: Record<PipelineConfig["interpreter"], Interpreter> = {
  rules: rulesInterpreter,
};

export function interpreterFor(config: PipelineConfig): Interpreter {
  return INTERPRETERS[config.interpreter];
}
