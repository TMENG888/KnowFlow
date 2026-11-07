"""Full local audio transcription with Qwen3-ASR 0.6B and resumable chunks."""
import argparse
import hashlib
import json
import math
import os
import re
import sys
import time
import wave
from pathlib import Path

MODEL_ID = 'Qwen/Qwen3-ASR-0.6B'
BACKEND = 'qwen3-asr-0.6b'
SAMPLE_RATE = 16000


def atomic_json(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    part = file.with_name(file.name + '.part')
    part.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(part, file)


def plan_chunks(audio, seconds):
    import numpy as np
    if len(audio) <= 0 or not math.isfinite(seconds) or not 5 <= seconds <= 30:
        raise ValueError('ASR_CHUNK_RANGE: use 5 to 30 seconds and nonempty audio')
    step = int(seconds * SAMPLE_RATE)
    start, result = 0, []
    while start < len(audio):
        end = min(start + step, len(audio))
        if end < len(audio):
            left = max(start + SAMPLE_RATE * 5, end - SAMPLE_RATE * 2)
            # Choose a quiet 100ms boundary within the previous two seconds.
            # No audio samples are dropped or duplicated between chunks.
            candidates = range(left, end - 1600 + 1, 1600)
            quiet = min(candidates, key=lambda pos: float(np.mean(np.abs(audio[pos:pos+1600]))), default=None)
            if quiet is not None and float(np.mean(np.abs(audio[quiet:quiet+1600]))) < .015:
                end = quiet + 800
        result.append((start, end))
        start = end
    return result


def decode_audio(file, max_seconds):
    import av
    import numpy as np
    pieces, count = [], 0
    with av.open(str(file)) as container:
        if not container.streams.audio:
            raise RuntimeError('MEDIA_NO_AUDIO')
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format='s16', layout='mono', rate=SAMPLE_RATE)
        def append(frame):
            nonlocal count
            pcm = frame.to_ndarray().reshape(-1)
            count += len(pcm)
            if count / SAMPLE_RATE > max_seconds:
                raise RuntimeError('VIDEO_DURATION_LIMIT: full audio exceeds limit; no truncated transcript accepted')
            pieces.append(pcm)
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame): append(resampled)
        for resampled in resampler.resample(None): append(resampled)
    if not pieces or count == 0:
        raise RuntimeError('MEDIA_EMPTY_AUDIO')
    return np.concatenate(pieces).astype(np.float32) / 32768.0


def validate_model(folder):
    folder = Path(folder)
    if not folder.is_dir():
        raise RuntimeError('ASR_MODEL_MISSING: local Qwen3-ASR 0.6B directory required')
    config = json.loads((folder/'config.json').read_text(encoding='utf-8'))
    text = config.get('thinker_config', {}).get('text_config', {})
    if config.get('model_type') != 'qwen3_asr' or (text.get('hidden_size'), text.get('num_hidden_layers')) != (1024, 28):
        raise RuntimeError('ASR_MODEL_MISMATCH: expected Qwen3-ASR 0.6B; no alternate model will be loaded')
    return hashlib.sha256((folder/'config.json').read_bytes()).hexdigest()


def load_progress(file, signature, ranges):
    try:
        progress = json.loads(Path(file).read_text(encoding='utf-8'))
        rows = progress['segments']
        if progress['signature'] != signature or not isinstance(rows, list) or len(rows) > len(ranges): return []
        for row, (start, end) in zip(rows, ranges):
            if row['start'] != round(start/SAMPLE_RATE, 3) or row['end'] != round(end/SAMPLE_RATE, 3) or not isinstance(row['text'], str): return []
        return rows
    except (OSError, ValueError, KeyError, TypeError):
        return []


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    for option in ['input', 'output', 'model', 'temp']: parser.add_argument('--'+option, required=True)
    parser.add_argument('--backend', choices=[BACKEND], default=BACKEND)
    parser.add_argument('--max-seconds', type=float, default=1800)
    parser.add_argument('--chunk-seconds', type=float, default=25)
    parser.add_argument('--threads', type=int, default=8)
    parser.add_argument('--device', choices=['auto', 'cpu', 'cuda'], default='auto')
    parser.add_argument('--language', default='Chinese')
    args = parser.parse_args()
    if args.threads < 1 or not math.isfinite(args.max_seconds) or args.max_seconds <= 0: raise ValueError('ASR_INVALID_LIMITS')
    temp = Path(args.temp)
    temp.mkdir(parents=True, exist_ok=True)
    for key, child in [('HF_HOME','hf-cache'),('TORCH_HOME','torch-cache'),('XDG_CACHE_HOME','cache'),('NUMBA_CACHE_DIR','numba-cache')]: os.environ[key] = str(temp/child)
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
                      OMP_NUM_THREADS=str(args.threads), MKL_NUM_THREADS=str(args.threads),
                      TEMP=str(temp), TMP=str(temp), PYTHONDONTWRITEBYTECODE='1')
    model_hash = validate_model(args.model)
    audio = decode_audio(args.input, args.max_seconds)
    duration = len(audio)/SAMPLE_RATE
    ranges = plan_chunks(audio, args.chunk_seconds)
    wav = Path(args.output).with_suffix('.wav')
    wav.parent.mkdir(parents=True, exist_ok=True)
    pcm = (audio.clip(-1, 1) * 32768).clip(-32768, 32767).astype('<i2').tobytes()
    with wave.open(str(wav)+'.part', 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(SAMPLE_RATE); out.writeframes(pcm)
    os.replace(str(wav)+'.part', wav)
    import torch
    from qwen_asr import Qwen3ASRModel
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    device = ('cuda' if torch.cuda.is_available() else 'cpu') if args.device == 'auto' else args.device
    if device == 'cuda' and not torch.cuda.is_available(): raise RuntimeError('ASR_CUDA_UNAVAILABLE: requested CUDA unavailable; no silent fallback')
    dtype = torch.float16 if device == 'cuda' else torch.float32
    signature_data = {'version':1, 'model':MODEL_ID, 'configSHA256':model_hash,
                      'pcmSHA256':hashlib.sha256(pcm).hexdigest(), 'chunkSeconds':args.chunk_seconds,
                      'language':args.language, 'device':device, 'dtype':str(dtype), 'maxNewTokens':1024}
    signature = hashlib.sha256(json.dumps(signature_data, sort_keys=True).encode()).hexdigest()
    progress_file = Path(args.output).with_suffix('.progress.json')
    rows = load_progress(progress_file, signature, ranges)
    resumed = len(rows)
    started = time.perf_counter()
    model = None
    if len(rows) < len(ranges):
        model = Qwen3ASRModel.from_pretrained(str(Path(args.model)), dtype=dtype, device_map=device,
                    max_inference_batch_size=1, max_new_tokens=1024, attn_implementation='eager', local_files_only=True)
    for index in range(len(rows), len(ranges)):
        start, end = ranges[index]
        clip = audio[start:end]
        if float(abs(clip).max()) < .00001:
            text, language = '', ''
        else:
            with torch.inference_mode(): result = model.transcribe(audio=(clip, SAMPLE_RATE), language=args.language or None)
            text, language = result[0].text.strip(), result[0].language
        rows.append({'start':round(start/SAMPLE_RATE, 3), 'end':round(end/SAMPLE_RATE, 3),
                     'text':text, 'language':language, 'timestampType':'audio_chunk'})
        atomic_json(progress_file, {'signature':signature, 'parameters':signature_data,
                                   'status':'in_progress', 'segments':rows, 'expectedChunks':len(ranges)})
        print(json.dumps({'event':'chunk_completed', 'chunk':index+1, 'total':len(ranges)}, ensure_ascii=False), flush=True)
    text = '\n'.join(row['text'] for row in rows if row['text'])
    flags = []
    if len(text) < 20: flags.append('short_or_empty_text')
    if re.search(r'字幕\s*(?:by|来自|制作)|索兰娅|amara[.]org', text, re.I): flags.append('suspect_caption_phrase')
    if any(not row['text'] and float(abs(audio[round(row['start']*SAMPLE_RATE):round(row['end']*SAMPLE_RATE)]).max()) >= .00001 for row in rows): flags.append('non_silent_chunk_without_text')
    result = {'text':text, 'segments':rows, 'language':args.language or 'auto', 'languageProbability':None,
              'durationSeconds':round(duration, 3), 'audioFile':str(wav), 'model':MODEL_ID, 'backend':BACKEND,
              'device':device, 'computeType':str(dtype).removeprefix('torch.'), 'threads':args.threads,
              'timestampType':'audio_chunk', 'wordTimestamps':False, 'source':'audio_asr',
              'quality':'review_required' if flags else 'passed', 'qualityFlags':flags,
              'qualityPolicy':'basic_completeness_only_not_accuracy', 'chunkSeconds':args.chunk_seconds,
              'chunksCompleted':len(rows), 'chunksExpected':len(ranges), 'resumedChunks':resumed,
              'pcmSHA256':signature_data['pcmSHA256'], 'configSHA256':model_hash,
              'processingSeconds':round(time.perf_counter()-started, 3)}
    atomic_json(args.output, result)
    atomic_json(progress_file, {'signature':signature, 'parameters':signature_data, 'status':'completed', 'segments':rows, 'expectedChunks':len(ranges)})
    print(json.dumps({'status':'completed', 'model':MODEL_ID, 'device':device, 'chars':len(text), 'durationSeconds':round(duration,3), 'quality':result['quality']}, ensure_ascii=False))


if __name__ == '__main__': main()
