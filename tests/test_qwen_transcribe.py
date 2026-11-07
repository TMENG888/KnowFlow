import sys, unittest, tempfile, json
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from qwen_transcribe import plan_chunks, load_progress, validate_model, atomic_json, decode_audio

class QwenTests(unittest.TestCase):
    def test_long_audio_has_no_gaps_or_duplicated_frames(self):
        audio=np.ones(16000*73+3,dtype=np.float32)*.2
        audio[23*16000:24*16000]=0
        ranges=plan_chunks(audio,25)
        self.assertEqual(ranges[0][0],0);self.assertEqual(ranges[-1][1],len(audio))
        self.assertEqual(sum(b-a for a,b in ranges),len(audio))
        for previous,current in zip(ranges,ranges[1:]):self.assertEqual(previous[1],current[0])
        with self.assertRaises(ValueError):plan_chunks(audio,60)
    def test_resume_only_matching_audio_model_and_ranges(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'progress.json';ranges=[(0,16000),(16000,32000)]
            atomic_json(file,{'signature':'same','segments':[{'start':0.,'end':1.,'text':'已完成分段'}]})
            self.assertEqual(len(load_progress(file,'same',ranges)),1)
            self.assertEqual(load_progress(file,'other',ranges),[])
            self.assertEqual(load_progress(file,'same',[(0,20000)]),[])
            file.write_text('{broken',encoding='utf-8');self.assertEqual(load_progress(file,'same',ranges),[])
    def test_reject_other_models(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'config.json';file.write_text(json.dumps({'model_type':'whisper'}))
            with self.assertRaisesRegex(RuntimeError,'ASR_MODEL_MISMATCH'):validate_model(tmp)
    def test_duration_limit_rejects_entire_audio(self):
        import wave
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'sample.wav'
            with wave.open(str(file),'wb') as f:
                f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(bytes(16000*2*2))
            self.assertEqual(len(decode_audio(file,3)),32000)
            with self.assertRaisesRegex(RuntimeError,'VIDEO_DURATION_LIMIT'):decode_audio(file,1)

if __name__=='__main__':unittest.main()
