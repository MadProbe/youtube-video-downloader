import { inspect } from "util";
import fetch from "node-fetch";
import FORMATS from "./formats.mjs";



const VIDEO_URL = 'https://www.youtube.com/watch?v=';
const EMBED_URL = 'https://www.youtube.com/embed/';
const VIDEO_EURL = 'https://youtube.googleapis.com/v/';
const INFO_HOST = 'www.youtube.com';
const INFO_PATH = '/get_video_info';
// Try getting config from the video page first.
const params = `hl=en`;
const watchPageURL = `${ VIDEO_URL + "VMM7E464Qtc" }&${ params }&bpctr=${ Math.ceil(Date.now() / 1000) }`;
const jsonEndpointURL = `${ watchPageURL }&pbj=1`;

const reqOptions = {
    headers: {
        'x-youtube-client-name': '1',
        'x-youtube-client-version': '2.20200701.03.01',
        'x-youtube-identity-token': '',
    }
};
const data = (await fetch(jsonEndpointURL, reqOptions).then(res => res.json()))
    .reduce((part, curr) => Object.assign(curr, part), {})
    .playerResponse
    .streamingData;
// ytdl-core/lib/formats-utils.js:5::62
// Use these to help sort formats, higher index is better.
const audioEncodingRanks = [
    'mp4a',
    'mp3',
    'vorbis',
    'aac',
    'opus',
    'flac',
];
const videoEncodingRanks = [
    'mp4v',
    'avc1',
    'Sorenson H.283',
    'MPEG-4 Visual',
    'VP8',
    'VP9',
    'H.264',
];

const getVideoBitrate = format => format.bitrate || 0;
const getVideoEncodingRank = format =>
    videoEncodingRanks.findIndex(enc => format.codecs && format.codecs.includes(enc));
const getAudioBitrate = format => format.audioBitrate || 0;
const getAudioEncodingRank = format =>
    audioEncodingRanks.findIndex(enc => format.codecs && format.codecs.includes(enc));


/**
 * Sort formats by a list of functions.
 *
 * @param {Object} a
 * @param {Object} b
 * @param {Array.<Function>} sortBy
 * @returns {number}
 */
const sortFormatsBy = (a, b, sortBy) => {
    let res = 0;
    for (let fn of sortBy) {
        res = fn(b) - fn(a);
        if (res !== 0) {
            break;
        }
    }
    return res;
};


const sortFormatsByVideo = (a, b) => sortFormatsBy(a, b, [
    format => parseInt(format.qualityLabel),
    getVideoBitrate,
    getVideoEncodingRank,
]);


const sortFormatsByAudio = (a, b) => sortFormatsBy(a, b, [
    getAudioBitrate,
    getAudioEncodingRank,
]);
const between = (haystack, left, right) => {
    let pos;
    if (left instanceof RegExp) {
        const match = haystack.match(left);
        if (!match) { return ''; }
        pos = match.index + match[0].length;
    } else {
        pos = haystack.indexOf(left);
        if (pos === -1) { return ''; }
        pos += left.length;
    }
    haystack = haystack.slice(pos);
    pos = haystack.indexOf(right);
    if (pos === -1) { return ''; }
    haystack = haystack.slice(0, pos);
    return haystack;
};
/**
 * @param {Object} format
 * @returns {Object}
 */
const addFormatMeta = format => {
    console.log(format.itag, format.mimeType, FORMATS[format.itag])
    const additionalEntries = Object.fromEntries(new URLSearchParams(format.signatureCipher || format.cipher).entries());
    format = Object.assign({}, FORMATS[format.itag], format, additionalEntries);
    format.hasVideo = !!format.qualityLabel;
    format.hasAudio = !!format.audioBitrate;
    format.container = format.mimeType ?
        format.mimeType.split(';')[0].split('/')[1] : null;
    format.codecs = format.mimeType ?
        between(format.mimeType, 'codecs="', '"') : null;
    format.videoCodec = format.hasVideo && format.codecs ?
        format.codecs.split(', ')[0] : null;
    format.audioCodec = format.hasAudio && format.codecs ?
        format.codecs.split(', ').slice(-1)[0] : null;
    format.isLive = /\bsource[/=]yt_live_broadcast\b/.test(format.url);
    format.isHLS = /\/manifest\/hls_(variant|playlist)\//.test(format.url);
    format.isDashMPD = /\/manifest\/dash\//.test(format.url);

    return format;
};

/**
 * Decipher a signature based on action tokens.
 *
 * @param {Array.<string>} tokens
 * @param {string} sig
 * @returns {string}
 */
const decipher = (tokens, sig) => {
    sig = sig.split('');
    for (let i = 0, len = tokens.length; i < len; i++) {
        let token = tokens[i], pos;
        switch (token[0]) {
            case 'r':
                sig = sig.reverse();
                break;
            case 'w':
                pos = ~~token.slice(1);
                sig = swapHeadAndPosition(sig, pos);
                break;
            case 's':
                pos = ~~token.slice(1);
                sig = sig.slice(pos);
                break;
            case 'p':
                pos = ~~token.slice(1);
                sig.splice(0, pos);
                break;
        }
    }
    return sig.join('');
};


/**
 * Swaps the first element of an array with one of given position.
 *
 * @param {Array.<Object>} arr
 * @param {number} position
 * @returns {Array.<Object>}
 */
const swapHeadAndPosition = (arr, position) => {
    const first = arr[0];
    arr[0] = arr[position % arr.length];
    arr[position] = first;
    return arr;
};
const setDownloadURL = (format, sig) => {
    let decodedUrl;
    if (format.url) {
        decodedUrl = format.url;
    } else {
        return;
    }

    try {
        decodedUrl = decodeURIComponent(decodedUrl);
    } catch (err) {
        return;
    }

    // Make some adjustments to the final url.
    const parsedUrl = url.parse(decodedUrl, true);

    // Deleting the `search` part is necessary otherwise changes to
    // `query` won't reflect when running `url.format()`
    delete parsedUrl.search;

    let query = parsedUrl.query;

    // This is needed for a speedier download.
    // See https://github.com/fent/node-ytdl-core/issues/127
    query.ratebypass = 'yes';
    if (sig) {
        // When YouTube provides a `sp` parameter the signature `sig` must go
        // into the parameter it specifies.
        // See https://github.com/fent/node-ytdl-core/issues/417
        query[format.sp || 'signature'] = sig;
    }

    format.url = url.format(parsedUrl);
};
const decipherFormats = async (formats, html5player, options) => {
    let decipheredFormats = {};
    let tokens = await exports.getTokens(html5player, options);
    formats.forEach(format => {
        let cipher = format.signatureCipher || format.cipher;
        if (cipher) {
            Object.assign(format, Object.fromEntries(new URL(cipher).searchParams.entries()));
            delete format.signatureCipher;
            delete format.cipher;
        }
        const sig = tokens && format.s ? decipher(tokens, format.s) : null;
        setDownloadURL(format, sig);
        decipheredFormats[format.url] = format;
    });
    return decipheredFormats;
};
//console.log(inspect(data, !0, 1 / 0, true));
const sorted = [...data.formats, ...data.adaptiveFormats].map(addFormatMeta).sort(sortFormatsByAudio);
console.log("CHOSEN:\n", sorted)
