// this needs to run after markdown-notes-tree, that way we can make more assumptions about file contents

const path = require("path");
const fs = require("fs");
const childProcess = require("child_process");
const frontMatter = require("front-matter");

try {
    console.log("Performing custom checks and adjustments");
    run();
    console.log("Finished custom checks and adjustments");
} catch (error) {
    console.log(`Error: ${error.message}`);
    process.exit(1);
}

function run() {
    relativePathsStagedFiles = getRelativePathsStagedFiles();
    processFolder("", relativePathsStagedFiles);
}

function getRelativePathsStagedFiles() {
    const resultFromGit = childProcess.execSync("git diff --name-only --cached").toString();
    return getLines(resultFromGit).filter(line => !!line);
}

function processFolder(relativePath, relativePathsStagedFiles) {
    const entries = fs.readdirSync(getAbsolutePath(relativePath), { withFileTypes: true });

    for (const entry of entries) {
        const name = entry.name;
        const isDirectory = entry.isDirectory();
        const entryPath = path.join(relativePath, name);

        if (isDirectory && !shouldIgnoreDirectory(name)) {
            const readmePath = path.join(entryPath, "README.md");
            const readmeContents = fs.readFileSync(readmePath, { encoding: "utf-8" });
            checkCustomDirectoryReadmeTitle(readmeContents, name, readmePath)
            processFolder(entryPath, relativePathsStagedFiles);
        } else if (!isDirectory && !shouldIgnoreFile(name)) {
            const contents = fs.readFileSync(entryPath, { encoding: "utf-8" });
            checkContentsHeadingPresent(contents, entryPath);
            checkNoLooseLists(contents, entryPath);
            setLastModifiedIfNeeded(contents, entryPath, relativePathsStagedFiles);
        }
    }
}

function getAbsolutePath(relativePath) {
    return path.join(process.cwd(), relativePath);
}

function shouldIgnoreDirectory(name) {
    return name.startsWith(".") || name.startsWith("_") || name === "node_modules";
}

function shouldIgnoreFile(name) {
    return !name.endsWith(".md") || name === "README.md" || name === 'CONTRIBUTING.md';
}

function checkCustomDirectoryReadmeTitle(contents, name, relativePath) {
    const contentsLines = getLines(contents);
    
    // runs after markdown-notes-tree, so we know the position of the title
    const titleLine = contentsLines[2];

    if (!titleLine.startsWith("# ")) {
        throw new Error(`No title found in file ${relativePath}`);
    }

    const title = titleLine.substring(2);
    
    if (title === name) {
        throw new Error(`No custom title set in file ${relativePath}`);
    }
}

function getLines(input) {
    return input.split(/\r\n|\r|\n/);
}

function checkContentsHeadingPresent(contents, relativePath) {
    const contentsLines = getLines(contents);

    if (!contentsLines.includes('## Contents')) {
        throw new Error(`No 'Contents' heading found in file ${relativePath}`);
    }
}

function checkNoLooseLists(contents, relativePath) {
    const looseListRegex = /- +[^\r\n]+(\r\n\r\n|\r\r|\n\n)\s*-/;

    if (looseListRegex.test(contents)) {
        const firstMatch = looseListRegex.exec(contents)[0];
        throw new Error(`Loose list found in file ${relativePath}\nMatch: ${JSON.stringify(firstMatch)}`);
    }
}

function setLastModifiedIfNeeded(contents, relativePath, relativePathsStagedFiles) {
    const relativePathForwardSlashes = relativePath.replace(/\\/g, "/");
    const isStaged = relativePathsStagedFiles.includes(relativePathForwardSlashes);

    const parsedFrontMatter = frontMatter(contents);
    const attributes = parsedFrontMatter.attributes;
    const hasLastModified = !!attributes.last_modified;

    if (!isStaged && hasLastModified) {
        // no changes needed
        return;
    }

    if (isStaged) {
        attributes.last_modified = new Date().toISOString();
    } else {
        const lastModifiedFromGit = childProcess.execSync(`git log -1 --format=%cI ${relativePath}`).toString().trim();
        attributes.last_modified = lastModifiedFromGit;
    }

    const newFrontMatterContents = Object.entries(attributes).map(([key, value]) => `${key}: ${value}`).join("\n");
    const newFrontMatterString = "---\n" + newFrontMatterContents + "\n---";
    const newContents = newFrontMatterString + "\n\n" + parsedFrontMatter.body;
    fs.writeFileSync(getAbsolutePath(relativePath), newContents, { encoding: "utf-8" })
}
