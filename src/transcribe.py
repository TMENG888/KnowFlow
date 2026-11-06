"""Local video -> mono WAV -> Whisper -> timestamped transcript. No API keys."""
import sys, os, json, argparse, wave, re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
parser=argparse.ArgumentParser()
parser.add_argument('--input',required=True);parser.add_argument('--output',required=True)
parser.add_argument('--model',required=True);parser.add_argument('--site');parser.add_argument('--temp',required=True)
parser.add_argument('--max-seconds',type=float,default=1800)
args=parser.parse_args()
if args.site:sys.path.insert(0,args.site)
os.environ['OMP_NUM_THREADS']='3';os.environ['MKL_NUM_THREADS']='3'
os.environ['HF_HOME']=str(Path(args.temp)/'hf-cache');os.environ['XDG_CACHE_HOME']=str(Path(args.temp)/'cache')
from faster_whisper.audio import decode_audio
from faster_whisper import WhisperModel
audio=decode_audio(args.input,sampling_rate=16000)
duration=len(audio)/16000
if duration>args.max_seconds:raise RuntimeError('VIDEO_DURATION_LIMIT: full audio exceeds configured maximum; no truncated transcript accepted')
wav=Path(args.output).with_suffix('.wav');wav.parent.mkdir(parents=True,exist_ok=True)
with wave.open(str(wav),'wb') as out:
 out.setnchannels(1);out.setsampwidth(2);out.setframerate(16000);out.writeframes((audio.clip(-1,1)*32767).astype('<i2').tobytes())
model=WhisperModel(args.model,device='cpu',compute_type='int8',cpu_threads=3,num_workers=1,local_files_only=True)
segments,info=model.transcribe(audio,beam_size=3,temperature=0,condition_on_previous_text=False,vad_filter=True,word_timestamps=False)
rows=[{'start':round(s.start,3),'end':round(s.end,3),'text':s.text.strip(),'avgLogprob':s.avg_logprob,'noSpeechProb':s.no_speech_prob} for s in segments]
text='\n'.join(s['text'] for s in rows if s['text'])
suspect=bool(re.search(r'字幕\s*(?:by|来自|制作)|索兰娅|amara[.]org',text,re.I))
result={'text':text,'segments':rows,'language':info.language,'languageProbability':info.language_probability,'durationSeconds':round(duration,3),'audioFile':str(wav),'model':'faster-whisper-small','quality':'review_required' if suspect or len(text)<20 else 'passed','source':'audio_asr'}
Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':'completed','chars':len(text),'durationSeconds':round(duration,3),'quality':result['quality']},ensure_ascii=False))
