#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Phase 2 : Corrections supplémentaires pour les patterns manqués
 */

const FIXES_PHASE2 = [
    // Gap-4 standalone (manqué en phase 1 car pas suivi d'un espace)
    { pattern: /(\bclass="[^"]*)\bgap-4\b(?![\s]*sm:)/g, replacement: '$1gap-2.5 sm:gap-3 md:gap-4' },
    
    // py-4 standalone
    { pattern: /(\bclass="[^"]*)\bpy-4\b(?![\s]*sm:)/g, replacement: '$1py-3 sm:py-4' },
    
    // px-4 standalone (rare mais possible)
    { pattern: /(\bclass="[^"]*)\bpx-4\b(?![\s]*sm:)/g, replacement: '$1px-3 sm:px-4' },
    
    // Grids avec gap-4/gap-5 en fin de classe
    { pattern: /(\bgrid[^"]*)\sgap-4"/g, replacement: '$1 gap-2.5 sm:gap-3 md:gap-4"' },
    { pattern: /(\bgrid[^"]*)\sgap-5"/g, replacement: '$1 gap-3 sm:gap-4 md:gap-5"' },
    
    // Flex avec gap-4
    { pattern: /(\bflex[^"]*)\sgap-4"/g, replacement: '$1 gap-2.5 sm:gap-3 md:gap-4"' },
    { pattern: /(\bflex[^"]*)\sgap-4\s/g, replacement: '$1 gap-2.5 sm:gap-3 md:gap-4 ' },
];

const EXCLUSIONS = [
    'AgentChatPanel.tsx',
    'AgentChatView.tsx',
    'ApplicationAgentChatCard.tsx',
];

function processFile(filePath) {
    const fileName = path.basename(filePath);
    
    if (EXCLUSIONS.some(excl => fileName === excl)) {
        return { changed: false, reason: 'excluded' };
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    const original = content;
    let appliedFixes = 0;
    
    for (const fix of FIXES_PHASE2) {
        const matches = content.match(fix.pattern);
        if (matches) {
            content = content.replace(fix.pattern, fix.replacement);
            appliedFixes += matches.length;
        }
    }
    
    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        return { changed: true, fixes: appliedFixes };
    }
    
    return { changed: false, reason: 'no-match' };
}

function main() {
    // Récupérer tous les fichiers TSX
    const componentsFiles = execSync('find src/components -name "*.tsx"', { cwd: '/workspace/frontend', encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const pagesFiles = execSync('find src/pages -name "*.tsx"', { cwd: '/workspace/frontend', encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    
    const files = [...componentsFiles, ...pagesFiles].map(f => path.join('/workspace/frontend', f));
    
    console.log(`🔍 Phase 2 : Analyse de ${files.length} fichiers...`);
    
    let changedCount = 0;
    let excludedCount = 0;
    let noMatchCount = 0;
    const changedFiles = [];
    
    for (const file of files) {
        const result = processFile(file);
        
        if (result.changed) {
            changedCount++;
            const relativePath = path.relative('/workspace/frontend', file);
            changedFiles.push(relativePath);
            console.log(`✅ ${relativePath} (${result.fixes} corrections)`);
        } else if (result.reason === 'excluded') {
            excludedCount++;
        } else {
            noMatchCount++;
        }
    }
    
    console.log('\n📊 Résumé Phase 2 :');
    console.log(`  - ${changedCount} fichiers modifiés`);
    console.log(`  - ${excludedCount} fichiers exclus`);
    console.log(`  - ${noMatchCount} fichiers sans changement`);
    
    if (changedFiles.length > 0) {
        console.log('\n📝 Fichiers modifiés :');
        changedFiles.forEach(f => console.log(`  - ${f}`));
    }
}

main();
