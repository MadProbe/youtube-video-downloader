// @ts-checkimport { BotGuardClient, getChallenge } from 'bgutils-js/botguard';
import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import type { WebPoSignalOutput } from 'bgutils-js/shared-types';
import { buildURL, getHeaders } from 'bgutils-js/utils';
import { WebPoMinter } from 'bgutils-js/webpo';
import { stripIndents } from "common-tags";
import { socksDispatcher } from "fetch-socks";
import { createWriteStream } from "fs";
import { readFile, stat } from "fs/promises";
import type { ReloadPlaybackContext } from 'googlevideo/protos';
import { SabrStream, type SabrPlaybackOptions } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes } from 'googlevideo/utils';
import { JSDOM } from 'jsdom';
import { join } from "path";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { setGlobalDispatcher } from "undici";
import { inspect, parseArgs } from "util";
import { ClientType, Constants, Innertube, Platform, YTNodes, type SessionOptions, type Types } from 'youtubei.js';

Platform.shim.eval = async (data: Types.BuildScriptResult) => Function(data.output)();
/**
 * Generates a Proof of Origin token bound to the given video id using BotGuard.
 * A DOM is required because BotGuard expects a browser-like environment.
 */
async function generatePoToken(videoID: string): Promise<string> {
    const requestKey = 'O43z0dpjhgX20SCx4KAo';

    const dom = new JSDOM('<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>', {
        url: 'https://www.youtube.com/',
        referrer: 'https://www.youtube.com/'
    });

    Object.assign(globalThis, {
        window: dom.window,
        document: dom.window.document,
        location: dom.window.location,
        origin: dom.window.origin
    });

    if (!Reflect.has(globalThis, 'navigator')) {
        Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator });
    }

    const challenge = await getChallenge({ fetchFunction: fetch, requestKey });

    const interpreterJavascript = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;

    if (interpreterJavascript) {
        new Function(interpreterJavascript)();
    } else throw new Error('Interpreter javascript not available');

    const botGuardClient = await BotGuardClient.create({
        program: challenge.program,
        globalName: challenge.globalName,
        globalObject: globalThis
    });
    //#endregion

    //#region WebPO Minter
    const webPoSignalOutput: WebPoSignalOutput = [];
    const botguardResponse = await botGuardClient.snapshot({ webPoSignalOutput });

    const payload = [requestKey, botguardResponse];

    const integrityTokenResponse = await fetch(buildURL('GenerateIT', true), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload)
    });

    const integrityTokenJson = await integrityTokenResponse.json() as [string, number, number, string];

    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = integrityTokenJson;

    const integrityTokenData = {
        integrityToken,
        estimatedTtlSecs,
        mintRefreshThreshold,
        websafeFallbackToken
    };

    const webPoMinter = await WebPoMinter.create(integrityTokenData, webPoSignalOutput);
    //#endregion
    return await webPoMinter.mintAsWebsafeString(videoID);
}

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

async function downloadVideo(videoID: string, providedTitle?: string) {
    const info = await innertube.getBasicInfo(videoID);
    const title = providedTitle ?? info.basic_info.title ?? videoID;
    if (info.playability_status?.status !== "OK") {
        console.log(`${ title } at ${ videoID } cannot be played for some unbeknownst to me reason`);
        return;
    }
    console.log("Video ID: %s; Title: %s", videoID, title);
    // await writeFile("./meta-format-saved.txt", inspect(metaInfo, true, Infinity), "utf8");
    const path = join(outputDir, `${ escapeTitle(title) }.webm`);
    if (!(await stat(path).catch(() => null as never))?.size) {
        const poToken = await generatePoToken(videoID);

        const serverAbrStreamingUrl = await innertube.session.player?.decipher(
            info.streaming_data?.server_abr_streaming_url
        );
        const ustreamerConfig = info.player_config
            ?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config;

        if (!ustreamerConfig)
            throw new Error('Could not find the ustreamer config in the player response.');
        if (!serverAbrStreamingUrl)
            throw new Error('This video has no SABR streaming URL (it may use the legacy protocol).');

        const formats = info.streaming_data?.adaptive_formats.map(buildSabrFormat) ?? [];

        const stream = new SabrStream({
            formats,
            serverAbrStreamingUrl,
            videoPlaybackUstreamerConfig: ustreamerConfig,
            poToken,
            clientInfo: {
                clientName: parseInt(
                    Constants.CLIENT_NAME_IDS[innertube.session.context.client.clientName as keyof typeof Constants.CLIENT_NAME_IDS]
                ),
                clientVersion: innertube.session.context.client.clientVersion
            }
        });

        // The server may ask us to reload the player response (e.g. when formats expire).
        stream.on('reloadPlayerResponse', async (_reloadPlaybackContext: ReloadPlaybackContext) => {
            const reloaded = await innertube.getBasicInfo(videoID);
            const url = await innertube.session.player?.decipher(reloaded.streaming_data?.server_abr_streaming_url);
            const config = reloaded.player_config
                ?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config;
            if (url && config) {
                stream.setStreamingURL(url);
                stream.setUstreamerConfig(config);
            }
        });

        const options: SabrPlaybackOptions = {
            videoQuality: "144p",
            preferMP4: true,
            preferH264: true,
            enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY
        };

        console.info('Starting SABR download...\n');
        const { videoStream, audioStream, selectedFormats } = await stream.start(options);
        // const audio = await innertubeTV.download(videoID, {
        //     type: "audio",
        //     quality: "best",
        //     format: "webm",
        //     client: "WEB",
        // });
        await Promise.all([Readable.fromWeb(videoStream as any).forEach(() => { }), pipeline(Readable.fromWeb(audioStream as any), createWriteStream(path))]);

    }
}

function assert_type<T>(value: unknown): asserts value is T {}

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