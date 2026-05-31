import s01 from "./01-google-drive-obo.json";
import s02 from "./02-wrong-audience.json";
import s03 from "./03-workday-policy-deny.json";
import s04 from "./04-direct-vs-gateway-mcp.json";
import s05 from "./05-agent-to-agent-direct-vs-gateway.json";
import type { Scenario } from "../model/schema";
import { mergeMutations } from "./common";

export const scenarios: Scenario[] = [s01, s02, s03, s04, s05].map((scenario) => mergeMutations(scenario as Scenario));
