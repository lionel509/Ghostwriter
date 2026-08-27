import sys, warnings
warnings.filterwarnings("ignore")
from mlx_lm import load, generate
from mlx_lm.sample_utils import make_sampler
PROMPTS=[
 ("recipe step","3. **Rinse cold, hard, until the water runs clear.** This is the step that decides "
  "whether the dish works — it stops the cooking and"),
 ("maths","where $\\vec{F}=\\langle P,Q\\rangle$. The orientation matters because"),
 ("note footer","Cold noodles keep absorbing sauce overnight, which is why this one is better the "
  "next day.\n\n**Hub:**"),
 ("frontmatter","---\ntags:\n  - making\n  - recipe\n"),
 ("wikilink","Costed against the shopping list in [["),
]
samp=make_sampler(temp=0.3, top_p=0.9)
def run(label, adapter):
    m,t = load("./models/qwen35-2b-base-4bit", adapter_path=adapter)
    print(f"\n### {label}")
    for name,p in PROMPTS:
        o = generate(m,t,prompt=p,max_tokens=22,sampler=samp,verbose=False)
        o = o.split("\n")[0][:78]
        print(f"  [{name:12}] {o!r}")
run("BASE (stock Qwen3.5-2B-Base)", None)
run("FINE-TUNED on the vault (iter 400)", "adapters")
