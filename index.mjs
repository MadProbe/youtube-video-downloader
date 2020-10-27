// @ts-check
import { createWriteStream, mkdtempSync } from "fs";
import { stripIndents } from "common-tags";
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import ytdl from "ytdl-core";

const args = process.argv.slice(2);
(async () => {
    if (args.includes("--help") || args.includes("-h")) {
        console.log(stripIndents`
            This is utility for downloading youtube videos, which have been made by MadProbe#7435.
            CLI options:
            --help | -h: print this help message.
            --re-encode: Re encodes output video file (download time increases drastically, but can reduce output file size).
        `)
        return;
    }
    const url = args.find(arg => /^https:\/\/(youtu\.be\/[\w\d]+|www\.youtube\.com\/watch\?.+)$/m.test(arg));
    const reencode = args.includes("--re-encode");
    const ms_div = 10e6;
    const year = 60 * 60 * 24 * 365;
    const day = 60 * 60 * 24;
    const hour = 60 * 60;
    const minute = 60;
    const formatDuration = (join => /**@param {number} seconds*/ seconds => {
        if (seconds) {
            const a = [];
            let y, m, d, h;
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
    })(array => array.slice(0, array.length - 1).join(', ') + (array.length !== 1 ? ' and ' : '') + array[array.length - 1]);
    /**
     * @param {[number, number]} timed
     */
    const formatTime = (timed, _formatted = formatDuration(timed[0])) =>
        `${ timed[0] ? `${ formatDuration(timed[0]) } and ` : "" }${ (timed[1] - timed[1] % ms_div) / ms_div } ms`;
    /**
     * @param {import("ytdl-core").Filter} filter
     * @param {import("fs").PathLike} path
     * @returns {Promise<void>}
     */
    function download(filter, path) {
        return new Promise((resolve, reject) => {
            ytdl.downloadFromInfo(meta, { filter })
                .on("error", reject)
                .on("end", resolve)
                .pipe(createWriteStream(path));
        })
    }
    const meta = await ytdl.getInfo(url);
    const { title } = meta.videoDetails;
    /**@type { [ytdl.videoFormat, number][] } */
    // @ts-ignore
    const labels = meta.formats
        .map(format => [format, parseInt(format.qualityLabel) || 0])
        .filter(([_, format]) => format <= 1080);
    const [format, quality] = labels.sort((prev, cur) => prev[1] - cur[1]).slice(-1)[0];
    const name = `${ title } ( ${ quality } X ${ quality / 9 * 16 } ).mp4`;
    // @ts-ignore
    const file = join(dirname(fileURLToPath(import.meta.url)), name);
    const _start = process.hrtime();
    if (!format.hasAudio) {
        const temp_dir = mkdtempSync("yt-video-downloader-");
        const temp_audio = join(temp_dir, `${ Math.random() }.webm`);
        const temp_video = join(temp_dir, `${ Math.random() }.mp4`);
        let start = process.hrtime();
        await download("audioonly", temp_audio);
        console.log("audio downloaded in", formatTime(process.hrtime(start)));
        start = process.hrtime();
        await download("videoonly", temp_video);
        console.log("video downloaded in", formatTime(process.hrtime(start)));
        start = process.hrtime();
        execSync(`ffmpeg.exe -y -i "${ temp_video }" -i "${ temp_audio }"${ !reencode ? " -c:v copy" : "" } -shortest "${ file }"`, { stdio: [] });
        console.log("video & audio merged in", formatTime(process.hrtime(start)));
        execSync(`rm -R ${ temp_dir }`)
        console.log(`File finished downloading in ${ formatTime(process.hrtime(_start)) }!`);
    } else {
        ytdl.downloadFromInfo(meta, { quality: format.itag })
            .on("error", console.error)
            .on("end", () => console.log(`File finished downloading in ${ formatTime(process.hrtime(_start)) }!`))
            .pipe(createWriteStream(file));
    }
})().catch(console.error);
