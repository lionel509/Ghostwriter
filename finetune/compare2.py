import warnings; warnings.filterwarnings("ignore")
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
 ("vault routing","Money coming in goes to Berkshire; money going out — purchases, capital, cost "
  "basis — goes to"),
 ("course note","## 11.5 Green's Theorem\n\n**Method:** For a positively oriented simple closed curve "
  "$C$ enclosing region $D$:\n$$\\oint_C"),
]
samp=make_sampler(temp=0.3, top_p=0.9)
def run(label, adapter):
    m,t = load("./models/qwen35-2b-base-4bit", adapter_path=adapter)
    print(f"\n### {label}")
    for name,p in PROMPTS:
        o = generate(m,t,prompt=p,max_tokens=24,sampler=samp,verbose=False)
        print(f"  [{name:13}] {o.split(chr(10))[0][:76]!r}")
run("BASE", None)
run("FINE-TUNED (iter 1400, val 1.652)", "adapters")
