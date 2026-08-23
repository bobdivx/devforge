#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Script pour corriger le responsive mobile sur tous les composants TSX.
 * Applique les patterns de correction identifiés dans les composants chat.
 */

const FIXES = [
    // Headers et sections - réduire padding mobile
    { pattern: /(\bclass="[^"]*)\bpx-3 py-3\b/g, replacement: '$1px-2.5 sm:px-3 py-2.5 sm:py-3' },
    { pattern: /(\bclass="[^"]*)\bpx-4 py-4\b/g, replacement: '$1px-3 sm:px-4 py-3 sm:py-4' },
    { pattern: /(\bclass="[^"]*)\bpx-5 py-4\b/g, replacement: '$1px-3 sm:px-4 md:px-5 py-3 sm:py-4' },
    { pattern: /(\bclass="[^"]*)\bpx-4 py-3\b/g, replacement: '$1px-2.5 sm:px-3 md:px-4 py-2.5 sm:py-3' },
    
    // Gap - réduire espacement mobile
    { pattern: /(\bclass="[^"]*)\bgap-3(\s)/g, replacement: '$1gap-2 sm:gap-3$2' },
    { pattern: /(\bclass="[^"]*)\bgap-4(\s)/g, replacement: '$1gap-2.5 sm:gap-3 md:gap-4$2' },
    { pattern: /(\bclass="[^"]*)\bgap-5(\s)/g, replacement: '$1gap-3 sm:gap-4 md:gap-5$2' },
    { pattern: /(\bclass="[^"]*)\bgap-x-3(\s)/g, replacement: '$1gap-x-2 sm:gap-x-3$2' },
    { pattern: /(\bclass="[^"]*)\bgap-x-4(\s)/g, replacement: '$1gap-x-2.5 sm:gap-x-3 md:gap-x-4$2' },
    { pattern: /(\bclass="[^"]*)\bgap-y-3(\s)/g, replacement: '$1gap-y-2 sm:gap-y-3$2' },
    
    // Tailles de texte - réduire sur mobile
    { pattern: /(\bclass="[^"]*)\btext-sm font-semibold\b/g, replacement: '$1text-xs sm:text-sm font-semibold' },
    { pattern: /(\bclass="[^"]*)\btext-sm font-medium\b/g, replacement: '$1text-xs sm:text-sm font-medium' },
    { pattern: /(\bclass="[^"]*)\btext-base font-semibold\b/g, replacement: '$1text-sm sm:text-base font-semibold' },
    
    // Icônes - réduire sur mobile
    { pattern: /(\bclass="[^"]*)\bsize-4(\s)/g, replacement: '$1size-3.5 sm:size-4$2' },
    { pattern: /(\bclass="[^"]*)\bsize-5(\s)/g, replacement: '$1size-4 sm:size-5$2' },
    { pattern: /(\bclass="[^"]*)\bsize-6(\s)/g, replacement: '$1size-5 sm:size-6$2' },
    
    // Boutons - réduire sur mobile
    { pattern: /(\bclass="btn[^"]*)\bsize-9 min-h-9\b/g, replacement: '$1size-8 sm:size-9 min-h-8 sm:min-h-9' },
    { pattern: /(\bclass="btn[^"]*)\bsize-10 min-h-10\b/g, replacement: '$1size-9 sm:size-10 min-h-9 sm:min-h-10' },
];

const EXCLUSIONS = [
    // Ne pas toucher aux fichiers déjà corrigés
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
    
    for (const fix of FIXES) {
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
    
    console.log(`🔍 Analyse de ${files.length} fichiers...`);
    
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
    
    console.log('\n📊 Résumé :');
    console.log(`  - ${changedCount} fichiers modifiés`);
    console.log(`  - ${excludedCount} fichiers exclus`);
    console.log(`  - ${noMatchCount} fichiers sans changement`);
    
    if (changedFiles.length > 0) {
        console.log('\n📝 Fichiers modifiés :');
        changedFiles.forEach(f => console.log(`  - ${f}`));
    }
}

main();
