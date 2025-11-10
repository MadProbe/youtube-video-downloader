// @ts-check
import { createWriteStream } from "fs";
import { stripIndents } from "common-tags";
import { join } from "path";
import { readFile, stat } from "fs/promises";
import { ClientType, Innertube, Platform, type SessionOptions, type Types, YTNodes } from 'youtubei.js';
import { Readable } from "stream";
import { inspect, parseArgs } from "util";
import { pipeline } from "stream/promises";
import { setGlobalDispatcher } from "undici";
import { socksDispatcher } from "fetch-socks";

Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
    const properties = [];

    if (env.n) {
        properties.push(`n: exportedVars.nFunction("${ env.n }")`);
    }

    if (env.sig) {
        properties.push(`sig: exportedVars.sigFunction("${ env.sig }")`);
    }

    const code = `${ data.output }\nreturn { ${ properties.join(', ') } }`;

    return Function(code)();
};
process.env["YTDL_NO_UPDATE"] = "1";
const cookies = await readFile("./cookies.txt", "utf-8");
const options: SessionOptions = {
    enable_safety_mode: false,
    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.3",
    client_type: ClientType.WEB,
    retrieve_player: true,
    device_category: 'desktop',
    enable_session_cache: true,
    cookie: cookies,
};
const innertube = await Innertube.create(options);
const innertubeTV = await Innertube.create({
    ...options,
    client_type: ClientType.TV
});

const { values: { help: doHelpMessage, "re-encode": reencode, "music-only": musicOnly, "output-dir": outputDir, "use-tor": useTor }, positionals } = parseArgs({
    "options": {
        help: {
            type: "boolean",
            short: "h"
        },
        "re-encode": {
            type: "boolean"
        },
        "music-only": {
            type: "boolean",
            short: "m"
        },
        "output-dir": {
            type: "string",
            short: "o",
            default: "."
        },
        "use-tor": {
            type: "boolean",
            short: "t",
            default: true,
        }
    },
    args: process.argv.slice(2),
    allowPositionals: true,
    allowNegative: true
});
if (useTor) {
    const dispatcher = socksDispatcher({
        type: 5,
        host: "127.0.0.1",
        port: 9050,
    });
    setGlobalDispatcher(dispatcher);
}
if (doHelpMessage) {
    console.log(stripIndents`
        This is utility for downloading youtube videos, made by MadProbe#7435.
        CLI options:
        --help | -h: print this help message.
        --re-encode: Re encodes output video file (download time increases drastically, but can reduce output file size).
        -m: download only audio
    `);
    process.exit(0);
}
const url = positionals[0];

const ms_div = 1e6;
const year = 60 * 60 * 24 * 365;
const day = 60 * 60 * 24;
const hour = 60 * 60;
const minute = 60;
const formatDuration = (join => (seconds: number) => {
    if (seconds) {
        const a = [] as any[];
        let y: string | number, m: string | number, d: string | number, h: string | number;
        if ((y = Math.floor(seconds / year)) >= 1) {
            a.push(y + ' year' + (y > 1 ? 's' : ''));
            seconds -= year * y;
        }
        if ((d = Math.floor(seconds / day)) >= 1) {
            a.push(d + ' day' + (d > 1 ? 's' : ''));
            seconds -= day * d;
        }
        if ((h = Math.floor(seconds / hour)) >= 1) {
            a.push(h + ' hour' + (h > 1 ? 's' : ''));
            seconds -= hour * h;
        }
        if ((m = Math.floor(seconds / minute)) >= 1) {
            a.push(m + ' minute' + (m > 1 ? 's' : ''));
            seconds -= minute * m;
        }
        if (seconds) {
            a.push(seconds + ' second' + (seconds > 1 ? 's' : ''));
        }
        return join(a);
    } else {
        return "now";
    }
})((array: any[]) => array.slice(0, array.length - 1).join(', ') + (array.length !== 1 ? ' and ' : '') + array[array.length - 1]);
const formatTime = (timed: [number, number], _formatted = formatDuration(timed[0])) =>
    `${ timed[0] ? `${ formatDuration(timed[0]) } and ` : "" }${ (timed[1] - timed[1] % ms_div) / ms_div } ms`;
const escapeTitle = (title: string) => title.replace(process.platform === "win32" ? /[\:\/\\\"\*\?\<\>\|]/g : /\//g, "_");
async function getResult<T, A extends any[]>(fn: (...args: A) => T, ...args: Parameters<typeof fn>): Promise<Awaited<T> | void> {
    try {
        return await fn(...args);
    } catch (error) {
        console.error(inspect(error, true, Infinity, process.stderr.hasColors?.() ?? false));
        return;
    }
}

let timesUnknownTitle = 0;

async function downloadVideo(videoID: string, providedTitle?: string) {
    console.log("Video ID: %s; Title: %s", videoID, providedTitle);
    const metaInfo = await innertube.getBasicInfo(videoID, { client: "WEB" });
    // await writeFile("./meta-format-saved.txt", inspect(metaInfo, true, Infinity), "utf8");
    const path = join(outputDir, `${ escapeTitle(providedTitle ?? metaInfo.basic_info.title ?? `??????${ ++timesUnknownTitle }`) }.webm`);
    if (!(await stat(path).catch(() => null as never))?.size) {
        const audio = await innertubeTV.download(videoID, {
            type: "audio",
            quality: "best",
            format: "webm",
            client: 'TV',
        });
        await pipeline(Readable.fromWeb(audio as any),
            createWriteStream(path));
    }
}

function assert_type<T>(value: unknown): asserts value is T {

}

async function downloadPlaylist(playlistID: string) {
    let playlistInfo = await innertube.getPlaylist(playlistID);
    do {
        console.log("Currently processing %s entries", playlistInfo.items.length);
        for (const playlistItem of playlistInfo.items) {
            if (playlistItem.type === "PlaylistVideo") {
                assert_type<YTNodes.PlaylistVideo>(playlistItem);
                await getResult(downloadVideo, playlistItem.id, playlistItem.title.toString());
            }
        }
    } while (playlistInfo.has_continuation && (playlistInfo = await playlistInfo.getContinuation()));
}

try {
    const playlistID = toPlaylistID(url);
    const videoID = toVideoID(url);
    console.log("URL: %s; Video ID: %s; Playlist ID: %s", url, videoID, playlistID);
    if (playlistID) {
        await downloadPlaylist(playlistID);
    } else if (videoID) {
        await downloadVideo(videoID);
    }
} catch (error) {
    console.error(inspect(error, true, Infinity, true));
    process.exit(1);
}

function toPlaylistID(url: string) {
    return url.match(/(?<=(playlist\?|&)list=)[\w\d-]+/i)?.[0];
}

function toVideoID(url: string) {
    return url.match(/(?<=v=)[\w\d-]+/i)?.[0];
}
/*
if (musicOnly) {
    function tryDownlaodFormats(containers: [string, string][], meta: import('@distube/ytdl-core').videoInfo) {
        const format = meta.formats.filter(format => containers.some(container => format.codecs === container[0] && format.container === container[1]) && format.hasAudio && !format.hasVideo)
            // @ts-ignore
            .sort((x, y) => y.audioBitrate - x.audioBitrate)[0];
        if (format) {
            console.log(`Found`, format, `format`);
            const time = process.hrtime();
            const filenameCore = `${ escapeTitle(meta.videoDetails.title) } ( ${ format.audioBitrate ?? "unknown " }kbs )`;

            ytdl.downloadFromInfo(meta, { format: format, })
                .on("error", console.error)
                .on("end", () => {
                    execSync(`ffmpeg -y -i ./"${ filenameCore }.${ format.container }" "./${ filenameCore }.opus"`);
                    console.log(`File finished downloading in ${ formatTime(process.hrtime(time)) }!`);
                })
                .pipe(createWriteStream(`${ filenameCore }.${ format.container }`));
            return;
        }
        console.error("No other audio formats were found...");
    }
    console.log([...new Set(meta.formats.map(x => [x.codecs, x.audioCodec, x.container]))]);
    const opus = meta.formats
        .filter((format) => format.codecs === 'opus' && format.container === 'webm' && format.hasAudio && !format.hasVideo)
        // @ts-ignore
        .sort((a, b) => b.audioBitrate - a.audioBitrate)[0];
    if (opus && false) {
        console.log(`!`);
        const time = process.hrtime();
        const file = `${ escapeTitle(meta.videoDetails.title) } ( ${ opus.audioBitrate ?? "unknown " }kbs ).opus`;
        ytdl.downloadFromInfo(meta, { format: opus })
            .on("error", console.error)
            .on("end", () => console.log(`File finished downloading in ${ formatTime(process.hrtime(time)) }!`))
            .pipe(createWriteStream(file));
    } else {
        console.error("opus format not found!");
        tryDownlaodFormats([["mp4a.40.5", "mp4"], ["mp4a.40.2", "mp4"]], meta);
    }
} else {
    function download(filter: import("@distube/ytdl-core").Filter, path: import("fs").PathLike): Promise<void> {
        return new Promise((resolve, reject) => {
            ytdl.downloadFromInfo(meta, { filter, format: filter === "videoonly" ? format : void 0, })
                .on("error", reject)
                .on("end", resolve)
                .pipe(createWriteStream(path));
        });
    }
    const { title } = meta.videoDetails;
    const labels = meta.formats
        .map((format): [ytdl.videoFormat, number] => [format, parseInt(format.qualityLabel) || 0])
        .filter(([_, format]) => format <= 1080 && _.hasVideo && (console.log(_.container), _.container) === "mp4");
    console.log([...new Set(meta.formats.map(x => [x.codecs, x.audioCodec, x.container]))]);
    const [[format, quality]] = labels.sort((prev, cur) => prev[1] - cur[1]).slice(-1);
    const tail = `( ${ quality } X ${ quality / 9 * 16 } ).mp4`;
    const name = `${ escapeTitle(title) } ${ tail }`;
    const file = join(process.cwd(), name);
    const _start = process.hrtime();
    if (!format.hasAudio) {
        const temp_dir = mkdtempSync("yt-video-downloader-");
        const temp_audio = join(temp_dir, `1${ Math.random() }.webm`);
        const temp_video = join(temp_dir, `2${ Math.random() }.${ format.container }`);
        let start = process.hrtime();
        await download("audioonly", temp_audio);
        console.log("audio downloaded in", formatTime(process.hrtime(start)));
        start = process.hrtime();
        await download("videoonly", temp_video);
        console.log("video downloaded in", formatTime(process.hrtime(start)));
        start = process.hrtime();
        execSync(`ffmpeg -y -i "${ temp_video }" -i "${ temp_audio }"${ !reencode ? " -c:v copy" : "" } -shortest "${ file }"`, { stdio: [] });
        console.log("video & audio merged in", formatTime(process.hrtime(start)));
        await rm(temp_dir, { recursive: true, force: true });
        console.log(`File finished downloading in ${ formatTime(process.hrtime(_start)) }!`);
    } else {
        ytdl.downloadFromInfo(meta, { quality: format.itag })
            .on("error", console.error)
            .on("end", () => console.log(`File finished downloading in ${ formatTime(process.hrtime(_start)) }!`))
            .pipe(createWriteStream(file));
    }
    console.log(file);
}
*/