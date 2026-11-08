#!/usr/bin/env node
import { runSkill } from '../../../scripts/shifen-skill.mjs';

await runSkill('raw', process.argv.slice(2));
