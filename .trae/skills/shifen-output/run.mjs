#!/usr/bin/env node
import { runSkill } from '../../../scripts/shifen-skill.mjs';

await runSkill('output', process.argv.slice(2));
