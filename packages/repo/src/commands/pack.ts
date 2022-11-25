import program from 'commander'
import fg from 'fast-glob'
import fs from 'fs-extra'
import { exec } from 'child_process'
import esbuild from 'esbuild'
import parallel from 'run-parallel'
import log from 'aronlog'

const packageJSON = fs.readJSONSync('./package.json')
const { dependencies, peerDependencies } = packageJSON
const defaultFormats = []

packageJSON.main && defaultFormats.push('cjs')
packageJSON.module && defaultFormats.push('mjs')
packageJSON.browser && defaultFormats.push('iife')

/** Extract external dependencies to prevent bundling */
const externalDependencies = []
dependencies && externalDependencies.push(...Object.keys(dependencies))
peerDependencies && externalDependencies.push(...Object.keys(peerDependencies))

program.command('pack [entryPaths...]')
    // .allowUnknownOption()
    .option('-f, --format [formats...]', 'The output format for the generated JavaScript files `iife`, `cjs`, `esm`', defaultFormats.join(',') || 'esm,cjs')
    .option('-b, --bundle', 'To bundle a file means to inline any imported dependencies into the file itself', true)
    .option('-m, --minify', 'The generated code will be minified instead of pretty-printed', true)
    .option('-w, --watch', 'Rebuild whenever a file changes', false)
    .option('-t, --type', 'Emit typescript declarations', !!packageJSON.types)
    .option('--outdir <path>', 'The output directory for the build operation', 'dist')
    .action((entry: string[], { format, bundle, minify, watch, outdir }) => {
        const formats = format.split(',')
        if (!entry.length) {
            entry = ['src/index.ts']
        }
        parallel(
            [
                ...formats.map((format) => async () => {
                    const entryPoints = fg.sync(entry)
                    await esbuild.build({
                        entryPoints,
                        outExtension: { '.js': { cjs: '.cjs', esm: '.mjs', iife: '.js' }[format] },
                        external: externalDependencies,
                        watch: watch ? {
                            onRebuild(error: string, result) {
                                if (error) log.error`${format} watch build failed ${new Error(error)}`
                                else log.watch`${format} rebuild succeeded`
                            }
                        } : false,
                        bundle, minify, outdir, format
                    } as esbuild.BuildOptions)
                        .then(result => {
                            log.watch`${format} ${reveal(entryPoints, 'entries')}`
                        })
                }),
                async () => {
                    const childProcess = await exec(`npm exec tsc ${entry.join(' ')} -- --emitDeclarationOnly --preserveWatchOutput --declaration --outDir ${outdir} ${watch && ' --watch'}`)
                    childProcess.stdout.on('data', (data: string) => {
                        log.success`${type} ${data.trim()}`
                    })
                    childProcess.stderr.on('data', (data: string) => {
                        log.error`${new Error(data.trim())}`
                    })
                    childProcess.on('close', (code) => {
                        log.i`tsc child process exited with code ${code}`
                    })
                }
            ]
        )
    })

function reveal(arr: string[], target) {
    if (arr.length > 2) {
        return `${arr.slice(0, 2).join(', ')}, and ${arr.length - 2} other ${target} ...`
    } else {
        return `${arr.join(', ')} ${target} ...`
    }
}