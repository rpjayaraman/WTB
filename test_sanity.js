#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Automated Sanity Test Suite: Dual-Engine Verification (Verilator vs. XEZIM)
 * What The Bug / UVM Verification Architect
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Executes all lab modules on both Verilator and Xezim engines, compares
 * the simulation results, and asserts that both engines produce matching,
 * passing outcomes (exit code 0).
 * 
 * Exit code 0 on 100% pass & match; Exit code 1 on any failure or mismatch.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Color formatting for console
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m'
};

// Setup simulated Web Worker environment for wasm_worker.js
let currentWorkerResolve = null;
global.self = {
    onmessage: null,
    postMessage: (msg) => {
        if (currentWorkerResolve) {
            currentWorkerResolve(msg);
        }
    }
};

// Load worker script
const workerPath = path.resolve(__dirname, 'wasm_worker.js');
if (!fs.existsSync(workerPath)) {
    console.error(`${C.red}Error: wasm_worker.js not found at ${workerPath}${C.reset}`);
    process.exit(1);
}
eval(fs.readFileSync(workerPath, 'utf8'));

// Load UVM Course Database
const uvmDbPath = path.resolve(__dirname, 'training/js/book_content.js');
global.window = {};
eval(fs.readFileSync(uvmDbPath, 'utf8'));
const uvmDb = global.window.UVM_COURSE_DATABASE || [];

function runSimulation(filesObj, engine) {
    return new Promise((resolve) => {
        currentWorkerResolve = resolve;
        const filesArr = Object.keys(filesObj).map(name => ({
            name,
            content: filesObj[name],
            category: 'design'
        }));

        const isVerilator = (engine === 'verilator');
        const plusargsStr = '+UVM_VERBOSITY=UVM_MEDIUM';
        const simCmd = isVerilator
            ? `verilator --binary -j 0 --timescale 1ns/1ns -Wall -Wno-fatal --timing -sv $FILE ${plusargsStr}`
            : `xezim --simulate --xtrace wave.vcd -DUVM_NO_DPI -I/Users/mac/xezim-workspace/uvm-1.2/src /Users/mac/xezim-workspace/uvm-1.2/src/uvm_pkg.sv $FILE ${plusargsStr}`;

        self.onmessage({
            data: {
                id: Math.floor(Math.random() * 1000000),
                type: 'SIMULATE',
                files: filesArr,
                command: simCmd,
                simulator: isVerilator ? 'verilator' : 'xezim_wasm'
            }
        });
    });
}

async function runSanitySuite() {
    console.log(`${C.bold}${C.cyan}`);
    console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║           ⚡ WHAT THE BUG — DUAL SIMULATION ENGINE SANITY TEST SUITE                ║');
    console.log('║               Verilator 5.052  vs.  XEZIM 0.11.0 IEEE 1800-2023                      ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
    console.log(`${C.reset}`);

    const report = {
        timestamp: new Date().toISOString(),
        totalChapters: 0,
        verilatorPassed: 0,
        xezimPassed: 0,
        matched: 0,
        mismatched: 0,
        chapters: []
    };

    let allPassed = true;

    for (let mIdx = 0; mIdx < uvmDb.length; mIdx++) {
        const mod = uvmDb[mIdx];
        console.log(`\n${C.bold}${C.blue}▶ Module ${String(mIdx + 1).padStart(2, '0')}: ${mod.title}${C.reset}`);
        console.log(`${C.gray}  ${'─'.repeat(82)}${C.reset}`);

        for (let cIdx = 0; cIdx < (mod.chapters || []).length; cIdx++) {
            const chap = mod.chapters[cIdx];
            report.totalChapters++;

            // 1. Run Verilator
            const t0V = Date.now();
            const resV = await runSimulation(chap.files || {}, 'verilator');
            const durV = Date.now() - t0V;
            const vOut = resV.result || {};
            const vPass = (vOut.exit_code === 0 && vOut.success);

            // 2. Run XEZIM
            const t0X = Date.now();
            const resX = await runSimulation(chap.files || {}, 'xezim');
            const durX = Date.now() - t0X;
            const xOut = resX.result || {};
            const xPass = (xOut.exit_code === 0 && xOut.success);

            if (vPass) report.verilatorPassed++;
            if (xPass) report.xezimPassed++;

            // 3. Compare Results
            const statusMatch = (vPass === xPass);
            const bothPassed = (vPass && xPass);

            if (statusMatch) report.matched++;
            else report.mismatched++;

            if (!bothPassed) allPassed = false;

            const vBadge = vPass ? `${C.green}✔ PASS (0)${C.reset}` : `${C.red}✖ FAIL (${vOut.exit_code})${C.reset}`;
            const xBadge = xPass ? `${C.green}✔ PASS (0)${C.reset}` : `${C.red}✖ FAIL (${xOut.exit_code})${C.reset}`;
            const matchBadge = statusMatch 
                ? (bothPassed ? `${C.green}★ MATCH${C.reset}` : `${C.yellow}⚠ BOTH FAIL${C.reset}`)
                : `${C.red}${C.bold}✖ MISMATCH${C.reset}`;

            const chapName = chap.id.padEnd(25);
            console.log(`  ${chapName} │ Verilator: ${vBadge} ${C.gray}(${durV}ms)${C.reset} │ XEZIM: ${xBadge} ${C.gray}(${durX}ms)${C.reset} │ ${matchBadge}`);

            if (!vPass) {
                console.log(`     ${C.red}↳ Verilator Error:${C.reset} ${(vOut.stderr || vOut.stdout || '').trim().split('\n')[0]}`);
            }
            if (!xPass) {
                console.log(`     ${C.red}↳ XEZIM Error:${C.reset} ${(xOut.stderr || xOut.stdout || '').trim().split('\n')[0]}`);
            }

            report.chapters.push({
                moduleId: mod.id,
                moduleTitle: mod.title,
                chapterId: chap.id,
                chapterTitle: chap.title,
                verilator: { exitCode: vOut.exit_code, pass: vPass, durationMs: durV },
                xezim: { exitCode: xOut.exit_code, pass: xPass, durationMs: durX },
                matched: statusMatch,
                passedBoth: bothPassed
            });
        }
    }

    // ── Print Final Summary ──
    console.log(`\n${C.bold}══════════════════════════════════════════════════════════════════════════════════════${C.reset}`);
    console.log(`${C.bold} SANITY AUDIT SUMMARY REPORT${C.reset}`);
    console.log(`${C.bold}══════════════════════════════════════════════════════════════════════════════════════${C.reset}`);
    console.log(`  Total Modules Tested  : ${uvmDb.length}`);
    console.log(`  Total Lab Chapters    : ${report.totalChapters}`);
    console.log(`  Verilator Passed      : ${report.verilatorPassed === report.totalChapters ? C.green : C.red}${report.verilatorPassed} / ${report.totalChapters} (${((report.verilatorPassed / report.totalChapters) * 100).toFixed(1)}%)${C.reset}`);
    console.log(`  XEZIM Passed          : ${report.xezimPassed === report.totalChapters ? C.green : C.red}${report.xezimPassed} / ${report.totalChapters} (${((report.xezimPassed / report.totalChapters) * 100).toFixed(1)}%)${C.reset}`);
    console.log(`  Cross-Engine Matches  : ${report.matched === report.totalChapters ? C.green : C.red}${report.matched} / ${report.totalChapters}${C.reset}`);
    console.log(`${C.bold}══════════════════════════════════════════════════════════════════════════════════════${C.reset}`);

    // Write report file
    fs.writeFileSync(path.resolve(__dirname, 'sanity_report.json'), JSON.stringify(report, null, 2));

    if (allPassed) {
        console.log(`${C.green}${C.bold}✨ SANITY TEST PASSED: All ${report.totalChapters} chapters verified on both Verilator and XEZIM!${C.reset}\n`);
        process.exit(0);
    } else {
        console.error(`${C.red}${C.bold}❌ SANITY TEST FAILED: One or more labs encountered errors or engine divergence.${C.reset}\n`);
        process.exit(1);
    }
}

runSanitySuite().catch((err) => {
    console.error(`${C.red}Unhandled Sanity Exception:${C.reset}`, err);
    process.exit(1);
});
