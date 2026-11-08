#!/usr/bin/env node
import { runSkill } from '../../../scripts/shifen-skill.mjs';

await runSkill('wiki', process.argv.slice(2));
