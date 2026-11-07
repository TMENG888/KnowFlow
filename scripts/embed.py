"""Offline BGE CLS embeddings. JSON stdin/stdout; never downloads models."""
import os, sys, json
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', TOKENIZERS_PARALLELISM='false', PYTHONDONTWRITEBYTECODE='1')

def main():
    import torch
    from transformers import AutoTokenizer, AutoModel
    data=json.load(sys.stdin)
    torch.set_num_threads(4)
    tokenizer=AutoTokenizer.from_pretrained(data['model'], local_files_only=True, trust_remote_code=False)
    model=AutoModel.from_pretrained(data['model'], local_files_only=True, trust_remote_code=False).eval().to('cpu')
    vectors=[]
    with torch.inference_mode():
        for start in range(0,len(data['texts']),8):
            batch=data['texts'][start:start+8]
            tokens=tokenizer(batch,padding=True,truncation=False,return_tensors='pt')
            if tokens['input_ids'].shape[1]>512: raise ValueError('Embedding text exceeds 512 tokens; split without truncating')
            vector=model(**tokens).last_hidden_state[:,0]
            vectors.extend(torch.nn.functional.normalize(vector,p=2,dim=1).tolist())
    json.dump({'vectors':vectors,'dimensions':model.config.hidden_size,'pooling':'cls-l2','device':'cpu'},sys.stdout)

if __name__=='__main__':
    try: main()
    except Exception:
        print('Offline embedding failed; check local model and dependencies',file=sys.stderr)
        sys.exit(1)
