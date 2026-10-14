export function normalizeDocumentTitle(value = '') {
  const normalized = String(value).trim().toLowerCase().replace(/\.[^.\s]+$/, '')
    .replace(/[’‘'`]/g, '').replace(/[-_]/g, ' ').trim().replace(/\s+/g, ' ')
  if (normalized === 'jumper knee') return 'jumpers knee'
  if (normalized === 'mri right knee') return 'right knee mri'
  if (normalized === 'cervical spondylosis prescription') return 'medical prescription'
  if (normalized === 'cervical spine x ray' || normalized === 'cervical spine xray') return 'cervical spine'
  if (['ct coronary angiography', 'coronary angiography', 'ccta'].includes(normalized)) return 'coronary ct'
  if (['diabetes screening', 'diabetes screening & monitoring', 'diabetes monitoring report'].includes(normalized)) return 'diabetes lab report'
  if (['hypertension assessment', 'blood pressure report'].includes(normalized)) return 'hypertension lab report'
  return normalized
}

const cervicalSpondylosis = Object.freeze({
  key: 'cervical spondylosis', title: 'Cervical Spondylosis', patient: 'Nandar Kyaw', age: '22 years', sex: 'Female', reportType: 'Cervical Spine X-ray',
  english: `Cervical Spondylosis Report Summary

Patient Name: Nandar Kyaw
Age: 22 years
Sex: Female
Report Type: Cervical Spine X-ray (Sample)

Overall Health Summary:

Your sample report describes mild changes in the bones and discs of your neck, particularly between the C5 and C6 vertebrae. These changes may suggest early cervical spondylosis, commonly called neck arthritis or age-related wear and tear.

The normal curve of your neck is also slightly straightened. No fracture or dislocation is described.

Understanding Your Results:

1. Neck curvature
Result: Mild straightening
Meaning: Slight change in normal neck curve

2. C5–C6 disc
Result: Minimal narrowing
Meaning: Mild reduction in disc space

3. Neck bones
Result: Small bone spurs
Meaning: Mild degenerative changes

4. Spine alignment
Result: Maintained
Meaning: Normal alignment

5. Fracture / Dislocation
Result: None seen
Meaning: No acute bone injury described

6. Surrounding soft tissues
Result: Unremarkable
Meaning: No obvious abnormality

What Does This Mean for You?

Your example report suggests mild changes in your cervical spine, which may be associated with neck pain or stiffness.

However, these X-ray findings do not necessarily mean that you have cervical spondylosis or that the changes are causing your symptoms.

Health Recommendations:

- Maintain good posture while studying or using a computer.
- Avoid keeping your neck bent forward for long periods.
- Take regular breaks and gently move your neck.
- Consult a doctor or physiotherapist if neck pain persists.
- Seek prompt medical attention if you develop worsening arm or leg weakness, difficulty walking, or new bladder or bowel control problems.

Final Summary:

The sample report describes mild neck-spine changes without an acute bone injury. A healthcare professional must assess your symptoms and examination findings to determine whether treatment is needed.`,
  myanmar: `Cervical Spondylosis Report Summary

Patient Name: Nandar Kyaw
Age: 22 years
Sex: Female
Report Type: Cervical Spine X-ray

ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်

နမူနာ X-ray စစ်ဆေးမှုရလဒ်အရ လည်ပင်းကျောရိုး C5 နှင့် C6 အကြားရှိ အရိုးနှင့် Disc တွင် အနည်းငယ်ပြောင်းလဲမှုများ တွေ့ရသည်ဟု ဖော်ပြထားပါသည်။

ဤပြောင်းလဲမှုများသည် လည်ပင်းကျီးပေါင်းရောဂါ (Cervical Spondylosis) ၏ အစောပိုင်းလက္ခဏာများနှင့် ဆင်တူနိုင်ပါသည်။

ထို့အပြင် လည်ပင်းကျောရိုး၏ ပုံမှန်အကွေးမှာ အနည်းငယ်ဖြောင့်နေသော်လည်း အရိုးကျိုးခြင်း သို့မဟုတ် အဆစ်လွဲခြင်း မတွေ့ရှိရဟု ဖော်ပြထားပါသည်။

စစ်ဆေးမှုရလဒ်များ

1. လည်ပင်းအကွေး
ရလဒ်: အနည်းငယ်ဖြောင့်
အခြေအနေ: ပုံမှန်အကွေး ပြောင်းလဲမှု

2. C5–C6 Disc
ရလဒ်: အနည်းငယ်ကျဉ်း
အခြေအနေ: Disc နေရာ လျော့နည်းမှု

3. လည်ပင်းအရိုး
ရလဒ်: အရိုးငုတ်ငယ်များ
အခြေအနေ: အနည်းငယ်ပြောင်းလဲမှု

4. ကျောရိုးတန်းညီမှု
ရလဒ်: ပုံမှန်
အခြေအနေ: ကောင်းမွန်

5. အရိုးကျိုး / အဆစ်လွဲ
ရလဒ်: မတွေ့ရှိ
အခြေအနေ: ထိခိုက်ဒဏ်ရာ မဖော်ပြထား

6. ပတ်ဝန်းကျင်တစ်ရှူး
ရလဒ်: ထူးခြားမှုမရှိ
အခြေအနေ: ပုံမှန်

လူနာအတွက် နားလည်လွယ်သော ရှင်းလင်းချက်

လည်ပင်းကျီးပေါင်းရောဂါဆိုသည်မှာ လည်ပင်းကျောရိုးနှင့် အရိုးကြားရှိ Disc များတွင် တဖြည်းဖြည်း ပြောင်းလဲမှုများ ဖြစ်ပေါ်လာခြင်းကို ဆိုလိုပါသည်။

ဤအခြေအနေမျိုးသည် လည်ပင်းနာကျင်ခြင်း၊ လည်ပင်းတောင့်တင်းခြင်းတို့နှင့် ဆက်စပ်နိုင်သော်လည်း X-ray ရလဒ်တစ်ခုတည်းဖြင့် ရောဂါရှိကြောင်း အတည်မပြုနိုင်ပါ။

အထူးသဖြင့် အသက် ၂၂ နှစ်အရွယ်တွင် လည်ပင်းကျီးပေါင်းရောဂါရှိသည်ဟု မယူဆမီ ဆရာဝန်၏ စစ်ဆေးမှု လိုအပ်ပါသည်။

ကျန်းမာရေးအကြံပြုချက်များ

- ကွန်ပျူတာနှင့် ဖုန်းအသုံးပြုချိန်တွင် လည်ပင်းကို အလွန်ငုံ့မထားပါနှင့်။
- အချိန်ကြာကြာ ထိုင်လုပ်ရပါက ကြားတွင် အနားယူပြီး လည်ပင်းကို ဖြည်းဖြည်းလှုပ်ရှားပေးပါ။
- စာကြည့်ခြင်းနှင့် ကွန်ပျူတာအသုံးပြုခြင်းတွင် သင့်တင့်သော ကိုယ်ဟန်အနေအထားကို ထိန်းသိမ်းပါ။
- လည်ပင်းနာကျင်မှု ဆက်လက်ရှိနေပါက ဆရာဝန် သို့မဟုတ် Physiotherapist နှင့် တိုင်ပင်ပါ။
- လက်ခြေအားနည်းမှု ပိုဆိုးလာခြင်း၊ လမ်းလျှောက်ရခက်ခြင်း၊ ဆီးဝမ်းထိန်းချုပ်မှုအသစ်ဖြစ်ပေါ်လာသော ပြဿနာများရှိပါက ချက်ချင်းဆေးကုသမှုခံယူပါ။

နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်

လည်ပင်းကျောရိုးတွင် အနည်းငယ်ပြောင်းလဲမှုရှိနိုင်သော်လည်း ပြင်းထန်သော အရိုးထိခိုက်မှုမျိုး မဖော်ပြထားပါ။

လည်ပင်းနာကျင်မှုရှိပါက ဆရာဝန်နှင့် စစ်ဆေးပြီးမှ သင့်တော်သောကုသမှုကို ဆုံးဖြတ်သင့်ပါသည်။`,
})

const anemia = Object.freeze({
  key: 'anemia', title: 'Anemia', summaryTitle: 'Anemia Lab', titleMyanmar: 'သွေးအားနည်းရောဂါ ဓာတ်ခွဲစစ်ဆေးမှု အကျဉ်းချုပ်',
  patient: 'Nandar Kyaw', age: '22 years', sex: 'Female', reportType: 'Anemia Laboratory Test',
  english: `Anemia Lab Report Summary

Patient Name: Nandar Kyaw
Age: 22 years
Sex: Female
Report Type: Anemia Laboratory Test

Overall Health Summary

Your sample blood test results show low hemoglobin (10.2 g/dL) and low iron stores (ferritin 10 ng/mL).

These findings suggest a pattern consistent with iron-deficiency anemia, meaning your body may not have enough iron to produce healthy red blood cells.

Understanding Your Results

1. Hemoglobin (Hb)
Result: 10.2 g/dL
Meaning: Low

2. Hematocrit (Hct)
Result: 32%
Meaning: Low

3. Red Blood Cell Count
Result: 4.1 ×10^12/L
Meaning: Within the listed reference range

4. MCV
Result: 74 fL
Meaning: Low — red blood cells are smaller than usual

5. MCH
Result: 24 pg
Meaning: Low — red blood cells contain less hemoglobin

6. RDW
Result: 16.2%
Meaning: High — greater variation in red blood cell size

7. Serum Ferritin
Result: 10 ng/mL
Meaning: Low iron stores

8. Serum Iron
Result: 35 mcg/dL
Meaning: Low circulating iron

9. Transferrin Saturation
Result: 10%
Meaning: Low

What Does This Mean for You?

Hemoglobin helps your red blood cells carry oxygen throughout your body.

When hemoglobin and iron levels are low, you may experience tiredness, weakness, dizziness, headaches, pale skin, or shortness of breath during physical activity.

Iron-deficiency anemia can result from insufficient dietary iron, heavy menstrual bleeding, or other causes of blood loss.

Health Recommendations

- Eat iron-rich foods such as meat, fish, beans, lentils, and dark green vegetables.
- Include vitamin C-rich foods, such as oranges or guava, to help your body absorb iron.
- Avoid tea or coffee close to iron-rich meals or iron supplements.
- Consult your doctor to identify the cause and determine whether iron supplements are needed.
- Repeat blood tests as recommended to monitor improvement.

Final Summary

Your sample results suggest a pattern consistent with iron-deficiency anemia. This condition is often treatable, but it is important to identify the underlying cause and receive appropriate medical care.`,
  myanmar: `သွေးအားနည်းရောဂါ ဓာတ်ခွဲစစ်ဆေးမှု အကျဉ်းချုပ်

Patient Name: Nandar Kyaw
Age: 22 years
Sex: Female
Report Type: Anemia Laboratory Test

ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်

နမူနာသွေးစစ်ဆေးမှုရလဒ်အရ သွေးတွင်းဟီမိုဂလိုဘင် (Hemoglobin)
နှင့် သံဓာတ်သိုလှောင်မှု (Ferritin) ပုံမှန်ထက် နည်းနေသည်ဟု
ဖော်ပြထားပါသည်။

ဤအခြေအနေသည် သံဓာတ်ချို့တဲ့ခြင်းကြောင့် ဖြစ်ပေါ်သော
သွေးအားနည်းရောဂါ (Iron-Deficiency Anemia) နှင့် ကိုက်ညီနိုင်ပါသည်။

သံဓာတ်မလုံလောက်သည့်အခါ ခန္ဓာကိုယ်အတွက် လိုအပ်သော
အောက်ဆီဂျင်ကို သယ်ဆောင်ပေးနိုင်သည့် ကျန်းမာသော သွေးနီဥများ
ထုတ်လုပ်ရာတွင် အခက်အခဲရှိနိုင်ပါသည်။

စစ်ဆေးမှုရလဒ်များ

1. ဟီမိုဂလိုဘင် (Hb)
ရလဒ်: 10.2 g/dL
အခြေအနေ: နည်းနေသည်

2. Hematocrit (Hct)
ရလဒ်: 32%
အခြေအနေ: နည်းနေသည်

3. သွေးနီဥအရေအတွက်
ရလဒ်: 4.1 ×10^12/L
အခြေအနေ: ဖော်ပြထားသော ပုံမှန်အတိုင်းအတာအတွင်းရှိသည်

4. MCV
ရလဒ်: 74 fL
အခြေအနေ: နည်းနေသည် — သွေးနီဥအရွယ်အစား သေးငယ်နေသည်

5. MCH
ရလဒ်: 24 pg
အခြေအနေ: နည်းနေသည် — သွေးနီဥတွင် ဟီမိုဂလိုဘင်ပါဝင်မှု နည်းနေသည်

6. RDW
ရလဒ်: 16.2%
အခြေအနေ: မြင့်နေသည် — သွေးနီဥအရွယ်အစား ကွာခြားမှုများရှိသည်

7. သံဓာတ်သိုလှောင်မှု (Ferritin)
ရလဒ်: 10 ng/mL
အခြေအနေ: နည်းနေသည်

8. သွေးတွင်းသံဓာတ်
ရလဒ်: 35 mcg/dL
အခြေအနေ: နည်းနေသည်

9. Transferrin Saturation
ရလဒ်: 10%
အခြေအနေ: နည်းနေသည်

လူနာအတွက် နားလည်လွယ်သော ရှင်းလင်းချက်

သွေးအားနည်းရောဂါဆိုသည်မှာ ခန္ဓာကိုယ်အနှံ့ အောက်ဆီဂျင်သယ်ဆောင်ပေးသော
ဟီမိုဂလိုဘင် လုံလောက်မှုမရှိခြင်း ဖြစ်ပါသည်။

ထိုသို့ဖြစ်ပါက အောက်ပါလက္ခဏာများ ခံစားရနိုင်ပါသည်။

- မကြာခဏ ပင်ပန်းနွမ်းနယ်ခြင်း
- မူးဝေခြင်းနှင့် ခေါင်းကိုက်ခြင်း
- အားနည်းခြင်း
- အသားအရေဖျော့တော့ခြင်း
- လှုပ်ရှားမှုလုပ်သည့်အခါ အသက်ရှူမဝခြင်း

အသက် ၂၂ နှစ်အရွယ် အမျိုးသမီးများတွင် သွေးအားနည်းခြင်းသည်
ရာသီသွေးဆင်းများခြင်း၊ သံဓာတ်ပါဝင်သော အစားအစာများ
လုံလောက်စွာမစားသုံးခြင်း သို့မဟုတ် အခြားသွေးဆုံးရှုံးမှုများကြောင့်
ဖြစ်နိုင်ပါသည်။

ကျန်းမာရေးအကြံပြုချက်များ

- အသား၊ ငါး၊ ပဲအမျိုးမျိုးနှင့် အစိမ်းရောင်ဟင်းသီးဟင်းရွက်များ စားသုံးပါ။
- သံဓာတ်စုပ်ယူမှုကောင်းစေရန် လိမ္မော်သီး၊ မာလကာသီးတို့ကို တွဲဖက်စားသုံးပါ။
- သံဓာတ်ကြွယ်ဝသော အစားအစာစားချိန်နှင့် သံဓာတ်ဆေးသောက်ချိန်အနီးတွင် လက်ဖက်ရည်နှင့် ကော်ဖီကို ရှောင်ကြဉ်ပါ။
- သံဓာတ်အားဖြည့်ဆေးကို ဆရာဝန်၏ အကြံပြုချက်ဖြင့်သာ သောက်သုံးပါ။
- ဆရာဝန်ညွှန်ကြားသည့်အတိုင်း သွေးပြန်စစ်ပြီး တိုးတက်မှုကို စောင့်ကြည့်ပါ။

နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်

နမူနာရလဒ်အရ သံဓာတ်ချို့တဲ့မှုကြောင့် သွေးအားနည်းနေသော
အခြေအနေနှင့် ကိုက်ညီနိုင်ပါသည်။

သင့်တော်သောအစားအသောက်၊ လိုအပ်သည့် သံဓာတ်ဖြည့်စွက်ကုသမှုနှင့်
ဆရာဝန်၏ စောင့်ကြည့်ကုသမှုတို့ဖြင့် သွေးအားနည်းမှုကို
များသောအားဖြင့် ကုသနိုင်ပါသည်။`,
})

const jumpersKnee = Object.freeze({
  key: 'jumpers knee', title: 'Jumper’s Knee', summaryTitle: 'Jumper’s Knee MRI',
  titleMyanmar: 'ဒူးခေါင်းအရွတ်ရောင်ရမ်းနာကျင်ခြင်း MRI စစ်ဆေးမှု အကျဉ်းချုပ်',
  patient: 'Eaindray Kyaw', age: '27 years', sex: 'Female', reportType: 'Knee MRI',
  english: `Jumper’s Knee MRI Report Summary

Patient Name: Eaindray Kyaw
Age: 27 years
Sex: Female
Report Type: Knee MRI
Condition: Jumper’s Knee (Patellar Tendinopathy)

Overall Health Summary

Your sample MRI report describes mild irritation and thickening of the patellar tendon, which connects your kneecap to your shinbone.

This condition is commonly called Jumper’s Knee (Patellar Tendinopathy).

The reassuring finding is that no tendon tear, major ligament injury, meniscus tear, or bone fracture is described.

Understanding Your Results

1. Patellar Tendon
Result:
Mild thickening and increased signal
Meaning:
Mild tendon changes consistent with patellar tendinopathy

2. Tendon Tear
Result:
No tendon tear described
Meaning:
Reassuring

3. Kneecap / Patella
Result:
Normal alignment
Meaning:
Normal

4. Knee Ligaments
Result:
Intact
Meaning:
No tear described

5. Menisci
Result:
Intact
Meaning:
No tear described

6. Knee Cartilage
Result:
Preserved
Meaning:
No significant damage described

7. Knee Bones
Result:
Normal alignment; no acute fracture or bone marrow edema described
Meaning:
No acute bone injury described

8. Joint Fluid
Result:
No significant joint effusion
Meaning:
No significant excess fluid described

What Does This Mean for You?

Jumper’s Knee occurs when the tendon below the kneecap becomes irritated from repeated stress, often during jumping, running, squatting, or other physical activities.

It may cause pain just below the kneecap, especially when climbing stairs, exercising, or bending the knee.

The sample report describes mild tendon changes without a tendon tear, which can often be managed with appropriate rehabilitation.

Health Recommendations

- Reduce painful activities:
  Temporarily limit jumping, running, and deep squatting if they worsen pain.
- Cold compress:
  Apply an ice pack wrapped in a towel for 10–15 minutes after painful activities.
- Physiotherapy:
  Follow a gradual tendon-strengthening exercise program guided by a physiotherapist.
- Exercise modification:
  Avoid pushing through significant pain.
- Medical follow-up:
  See a healthcare professional if pain persists or worsens.

Final Summary

The sample report describes mild Jumper’s Knee involving the patellar tendon, without a tendon tear or major structural knee injury.

With appropriate activity modification and rehabilitation, symptoms may improve, although tendon recovery can take several weeks or months.`,
  myanmar: `ဒူးခေါင်းအရွတ်ရောင်ရမ်းနာကျင်ခြင်း MRI စစ်ဆေးမှု အကျဉ်းချုပ်

Patient Name: Eaindray Kyaw
Age: 27 years
Sex: Female
Report Type: Knee MRI
Condition: Jumper’s Knee (Patellar Tendinopathy)

ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်

နမူနာ MRI စစ်ဆေးမှုရလဒ်အရ ဒူးခေါင်းအောက်ရှိ Patellar Tendon အရွတ်မှာ
အနည်းငယ်ထူလာပြီး အရွတ်တစ်ရှူးတွင် ပြောင်းလဲမှုရှိနေသည်ဟု
ဖော်ပြထားပါသည်။

ဤအခြေအနေကို Jumper’s Knee (Patellar Tendinopathy) ဟုခေါ်ပါသည်။

အဓိကအားဖြင့် ဒူးခေါင်းအောက်ရှိ အရွတ်ကို ထပ်ခါတလဲလဲ
ဖိအားသက်ရောက်ခြင်းကြောင့် ဖြစ်ပေါ်တတ်ပါသည်။

သို့သော် နမူနာရလဒ်တွင် အရွတ်ပြတ်ခြင်း၊ ဒူးအတွင်းရှိ
အဓိကအရွတ်များပြတ်ခြင်း၊ Meniscus ပြဲခြင်းနှင့်
အရိုးကျိုးခြင်းတို့ကို မဖော်ပြထားပါ။

စစ်ဆေးမှုရလဒ်များ

1. ဒူးခေါင်းအောက်အရွတ်
ရလဒ်:
အနည်းငယ်ထူပြီး signal ပြောင်းလဲမှုရှိ
အခြေအနေ:
Patellar tendinopathy နှင့် ကိုက်ညီသော အနည်းငယ်ပြောင်းလဲမှု

2. အရွတ်ပြတ်ခြင်း
ရလဒ်:
အရွတ်ပြတ်ခြင်း မဖော်ပြထား
အခြေအနေ:
ကောင်းမွန်

3. ဒူးခေါင်းအရိုး
ရလဒ်:
တည်နေရာမှန်ကန်
အခြေအနေ:
ပုံမှန်

4. ဒူးအတွင်းအရွတ်များ
ရလဒ်:
မပြတ်
အခြေအနေ:
ကောင်းမွန်

5. Meniscus
ရလဒ်:
မပြဲ
အခြေအနေ:
ပုံမှန်

6. ဒူးအရိုးနု
ရလဒ်:
ထိန်းသိမ်းထားနိုင်
အခြေအနေ:
သိသာသော ထိခိုက်မှု မဖော်ပြထား

7. ဒူးအရိုးများ
ရလဒ်:
အရိုးတန်းညီမှုကောင်းပြီး အရိုးကျိုးခြင်းမဖော်ပြထား
အခြေအနေ:
ပြင်းထန်သော အရိုးထိခိုက်မှု မဖော်ပြထား

8. အဆစ်အရည်
ရလဒ်:
သိသာစွာ မများ
အခြေအနေ:
ကောင်းမွန်

လူနာအတွက် နားလည်လွယ်သော ရှင်းလင်းချက်

Jumper’s Knee ဆိုသည်မှာ ဒူးခေါင်းအောက်ရှိ အရွတ်ကို
အကြိမ်ကြိမ် ဖိအားပေးအသုံးပြုခြင်းကြောင့်
အရွတ်နာကျင်မှုဖြစ်ပေါ်လာသော အခြေအနေတစ်ခု ဖြစ်ပါသည်။

အထူးသဖြင့် ပြေးခြင်း၊ ခုန်ခြင်း၊ လှေကားတက်ခြင်းနှင့်
ဒူးကွေးပြီး ထိုင်ထလုပ်ခြင်းတို့တွင်
နာကျင်မှု ပိုမိုခံစားရနိုင်ပါသည်။

ဤနမူနာရလဒ်အရ အရွတ်တွင် အနည်းငယ်ပြောင်းလဲမှုရှိသော်လည်း
အရွတ်ပြတ်သွားခြင်းမျိုး မဖော်ပြထားပါ။

သင့်တော်သော လေ့ကျင့်ခန်းကုထုံးနှင့် အနားယူမှုပုံစံများဖြင့်
သက်သာလာနိုင်သော အခြေအနေမျိုး ဖြစ်ပါသည်။

ကျန်းမာရေးအကြံပြုချက်များ

- ဒူးကို အနားပေးခြင်း:
  နာကျင်မှုကို ပိုဆိုးစေသော ပြေးခြင်း၊ ခုန်ခြင်းနှင့်
  ထိုင်ထလုပ်ခြင်းတို့ကို ယာယီလျှော့ချပါ။
- ရေခဲကပ်ခြင်း:
  နာကျင်မှုရှိပါက ရေခဲကို အဝတ်ဖြင့်ပတ်ပြီး
  ၁၀–၁၅ မိနစ်ခန့် ကပ်ပေးနိုင်ပါသည်။
- Physiotherapy:
  အရွတ်နှင့် ကြွက်သားများ သန်မာစေရန်
  ကျွမ်းကျင်သူ၏ လမ်းညွှန်မှုဖြင့် လေ့ကျင့်ခန်းပြုလုပ်ပါ။
- လှုပ်ရှားမှုထိန်းချုပ်ခြင်း:
  နာကျင်မှုများနေချိန်တွင် အတင်းအကျပ် လေ့ကျင့်ခန်းမပြုလုပ်ပါနှင့်။
- ဆရာဝန်နှင့်ပြသခြင်း:
  နာကျင်မှုမသက်သာပါက သို့မဟုတ် ပိုဆိုးလာပါက
  ဆရာဝန်နှင့် တိုင်ပင်ပါ။

နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်

နမူနာစစ်ဆေးမှုရလဒ်အရ ဒူးခေါင်းအောက်ရှိ Patellar Tendon အရွတ်တွင်
အနည်းငယ်ပြောင်းလဲမှုရှိပြီး Jumper’s Knee နှင့် ကိုက်ညီသော
လက္ခဏာများ ဖော်ပြထားပါသည်။

ပြင်းထန်သော အရွတ်ပြတ်ခြင်း သို့မဟုတ် အရိုးထိခိုက်မှုမျိုး
မဖော်ပြထားပါ။

လှုပ်ရှားမှုကို သင့်တင့်စွာလျှော့ချခြင်း၊ အရွတ်သန်မာစေသော
လေ့ကျင့်ခန်းကုထုံးများ ပြုလုပ်ခြင်းနှင့် ကျန်းမာရေးပညာရှင်၏
အကြံပြုချက်များကို လိုက်နာခြင်းဖြင့် သက်သာလာနိုင်ပါသည်။

ပြန်လည်ကောင်းမွန်ရန် ရက်သတ္တပတ်များမှ လများအထိ ကြာနိုင်ပါသည်။`,
})

const rightKneeMri = Object.freeze({
  key: 'right knee mri', title: 'Right Knee MRI', summaryTitle: 'Jumper’s Knee MRI',
  titleMyanmar: 'ဒူးခေါင်းအရွတ်ရောင်ရမ်းနာကျင်ခြင်း MRI စစ်ဆေးမှု အကျဉ်းချုပ်',
  patient: 'Eaindray Kyaw', age: '27 years', sex: 'Female', reportType: 'Right Knee MRI',
  english: `Jumper’s Knee MRI Report Summary

Patient Name: Eaindray Kyaw
Age: 27 years
Sex: Female
Examination: Right Knee MRI
Condition: Jumper’s Knee (Patellar Tendinopathy)

Overall Health Summary

Your sample MRI report describes mild irritation and thickening of the patellar tendon, which connects your kneecap to your shinbone.

This condition is commonly called Jumper’s Knee (Patellar Tendinopathy).

The reassuring finding is that no complete tendon tear, major ligament injury, meniscus tear, or bone fracture is described.

Understanding Your Results

1. Patellar Tendon
Result:
Mild thickening and increased signal
Meaning:
Mild tendon changes

2. Tendon Tear
Result:
No full-thickness tear
Meaning:
Reassuring

3. Kneecap (Patella)
Result:
Normal alignment
Meaning:
Normal

4. Knee Ligaments
Result:
Intact
Meaning:
No tear described

5. Menisci
Result:
Intact
Meaning:
No tear described

6. Knee Cartilage
Result:
Preserved
Meaning:
No significant damage

7. Knee Bones
Result:
Normal appearance
Meaning:
No fracture described

8. Joint Fluid
Result:
No significant excess
Meaning:
Reassuring

What Does This Mean for You?

Jumper’s Knee occurs when the tendon below the kneecap becomes irritated from repeated stress, often during jumping, running, squatting, or other physical activities.

It may cause pain just below the kneecap, especially when climbing stairs, exercising, or bending the knee.

The sample report describes mild tendon changes without a complete tear, which can often be managed with appropriate rehabilitation.

Health Recommendations

- Reduce painful activities:
  Temporarily limit jumping, running, and deep squatting if they worsen the pain.
- Cold compress:
  Apply an ice pack wrapped in a towel for 10–15 minutes after painful activities.
- Physiotherapy:
  Follow a gradual tendon-strengthening exercise program guided by a physiotherapist.
- Exercise modification:
  Avoid pushing through significant pain.
- Medical follow-up:
  See a healthcare professional if pain persists or worsens.

Final Summary

The sample report describes mild Jumper’s Knee involving the patellar tendon of the right knee, without a complete tendon tear or major knee injury.

With appropriate activity modification and rehabilitation, symptoms often improve, although tendon recovery can take several weeks or months.`,
  myanmar: `ဒူးခေါင်းအရွတ်ရောင်ရမ်းနာကျင်ခြင်း MRI စစ်ဆေးမှု အကျဉ်းချုပ်

Patient Name: Eaindray Kyaw
Age: 27 years
Sex: Female
Examination: Right Knee MRI
Condition: Jumper’s Knee (Patellar Tendinopathy)

ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်

နမူနာ MRI စစ်ဆေးမှုရလဒ်အရ ညာဘက်ဒူးခေါင်းအောက်ရှိ
Patellar Tendon အရွတ်မှာ အနည်းငယ်ထူလာပြီး
အရွတ်တစ်ရှူးတွင် ပြောင်းလဲမှုရှိနေသည်ဟု ဖော်ပြထားပါသည်။

ဤအခြေအနေကို Jumper’s Knee (Patellar Tendinopathy) ဟုခေါ်ပါသည်။

အဓိကအားဖြင့် ဒူးခေါင်းအောက်ရှိ အရွတ်ကို
ထပ်ခါတလဲလဲ ဖိအားသက်ရောက်ခြင်းကြောင့် ဖြစ်ပေါ်တတ်ပါသည်။

သို့သော် နမူနာရလဒ်တွင်
အရွတ်လုံးဝပြတ်ခြင်း၊ ဒူးအတွင်းရှိ အဓိကအရွတ်များပြတ်ခြင်း၊
Meniscus ပြဲခြင်းနှင့် အရိုးကျိုးခြင်းတို့ကို
မတွေ့ရှိရဟု ဖော်ပြထားပါသည်။

စစ်ဆေးမှုရလဒ်များ

1. ဒူးခေါင်းအောက်အရွတ်
ရလဒ်:
အနည်းငယ်ထူပြီး ပြောင်းလဲမှုရှိ
အခြေအနေ:
အနည်းငယ်ထိခိုက်

2. အရွတ်ပြတ်ခြင်း
ရလဒ်:
လုံးဝပြတ်ခြင်းမရှိ
အခြေအနေ:
ကောင်းမွန်

3. ဒူးခေါင်းအရိုး
ရလဒ်:
တည်နေရာမှန်ကန်
အခြေအနေ:
ပုံမှန်

4. ဒူးအတွင်းအရွတ်များ
ရလဒ်:
မပြတ်
အခြေအနေ:
ကောင်းမွန်

5. Meniscus
ရလဒ်:
မပြဲ
အခြေအနေ:
ပုံမှန်

6. ဒူးအရိုးနု
ရလဒ်:
ထိန်းသိမ်းထားနိုင်
အခြေအနေ:
ကောင်းမွန်

7. ဒူးအရိုးများ
ရလဒ်:
အရိုးကျိုးခြင်းမရှိ
အခြေအနေ:
ပုံမှန်

8. အဆစ်အရည်
ရလဒ်:
သိသာစွာ မများ
အခြေအနေ:
ကောင်းမွန်

လူနာအတွက် နားလည်လွယ်သော ရှင်းလင်းချက်

Jumper’s Knee ဆိုသည်မှာ ဒူးခေါင်းအောက်ရှိ အရွတ်ကို
အကြိမ်ကြိမ် ဖိအားပေးအသုံးပြုခြင်းကြောင့်
အရွတ်နာကျင်မှုဖြစ်ပေါ်လာသော အခြေအနေတစ်ခု ဖြစ်ပါသည်။

အထူးသဖြင့် ပြေးခြင်း၊ ခုန်ခြင်း၊ လှေကားတက်ခြင်းနှင့်
ဒူးကွေးပြီး ထိုင်ထလုပ်ခြင်းတို့တွင်
နာကျင်မှု ပိုမိုခံစားရနိုင်ပါသည်။

ဤနမူနာရလဒ်အရ အရွတ်တွင် အနည်းငယ်ပြောင်းလဲမှုရှိသော်လည်း
အရွတ်လုံးဝပြတ်သွားခြင်းမျိုး မဖော်ပြထားပါ။

သင့်တော်သော လေ့ကျင့်ခန်းကုထုံးနှင့် အနားယူမှုပုံစံများဖြင့်
သက်သာလာနိုင်သော အခြေအနေမျိုး ဖြစ်ပါသည်။

ကျန်းမာရေးအကြံပြုချက်များ

- ဒူးကို အနားပေးခြင်း:
  နာကျင်မှုကို ပိုဆိုးစေသော ပြေးခြင်း၊ ခုန်ခြင်းနှင့်
  ထိုင်ထလုပ်ခြင်းတို့ကို ယာယီလျှော့ချပါ။
- ရေခဲကပ်ခြင်း:
  နာကျင်မှုရှိပါက ရေခဲကို အဝတ်ဖြင့်ပတ်ပြီး
  ၁၀–၁၅ မိနစ်ခန့် ကပ်ပေးနိုင်ပါသည်။
- Physiotherapy:
  အရွတ်နှင့် ကြွက်သားများ သန်မာစေရန်
  ကျွမ်းကျင်သူ၏ လမ်းညွှန်မှုဖြင့် လေ့ကျင့်ခန်းပြုလုပ်ပါ။
- လှုပ်ရှားမှုထိန်းချုပ်ခြင်း:
  နာကျင်မှုများနေချိန်တွင် အတင်းအကျပ်
  လေ့ကျင့်ခန်းမပြုလုပ်ပါနှင့်။
- ဆရာဝန်နှင့်ပြသခြင်း:
  နာကျင်မှုမသက်သာပါက သို့မဟုတ် ပိုဆိုးလာပါက
  ဆရာဝန်နှင့် တိုင်ပင်ပါ။

နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်

နမူနာစစ်ဆေးမှုရလဒ်အရ ညာဘက်ဒူးခေါင်းအောက်ရှိ
Patellar Tendon အရွတ်တွင် အနည်းငယ်ပြောင်းလဲမှုရှိပြီး
Jumper’s Knee နှင့် ကိုက်ညီသော လက္ခဏာများ ဖော်ပြထားပါသည်။

ပြင်းထန်သော ဒူးအရွတ်ပြတ်ခြင်း သို့မဟုတ်
အရိုးထိခိုက်မှုမျိုး မဖော်ပြထားပါ။

လှုပ်ရှားမှုကို သင့်တင့်စွာလျှော့ချခြင်း၊
အရွတ်သန်မာစေသော လေ့ကျင့်ခန်းကုထုံးများ ပြုလုပ်ခြင်းနှင့်
ကျန်းမာရေးပညာရှင်၏ အကြံပြုချက်များကို လိုက်နာခြင်းဖြင့်
သက်သာလာနိုင်ပါသည်။

ပြန်လည်ကောင်းမွန်ရန် ရက်သတ္တပတ်များမှ လများအထိ ကြာနိုင်ပါသည်။`,
})

const hypertensionLabReport = Object.freeze({
  key: 'hypertension lab report', title: 'Hypertension Lab Report',
  titleEnglish: 'Patient-Friendly Hypertension Lab Report Summary',
  titleMyanmar: 'သွေးတိုးရောဂါ ဓာတ်ခွဲစစ်ဆေးမှု အကျဉ်းချုပ်',
  patient: 'U KyawAung Moe', age: '59 years', sex: 'Male', reportType: 'Hypertension Assessment',
  english: `Patient-Friendly Hypertension Lab Report Summary

Patient Name: U KyawAung Moe
Age: 59 years
Sex: Male
Report Type: Hypertension Assessment

Overall Health Summary

Your sample report shows that your blood pressure is higher than the recommended level.

Your cholesterol and fasting blood sugar are also slightly elevated.

The kidney function, sodium, potassium, and urine protein results are within the reference ranges shown in the report.

Understanding Your Results

1. Blood Pressure
Result:
158/96 mmHg
Meaning:
High — confirmation with repeat or out-of-office measurements is recommended

2. Kidney Function (Creatinine)
Result:
1.1 mg/dL
Meaning:
Within range

3. eGFR
Result:
76 mL/min/1.73 m²
Meaning:
Within report range

4. Sodium
Result:
140 mmol/L
Meaning:
Normal

5. Potassium
Result:
4.2 mmol/L
Meaning:
Normal

6. Blood Sugar (Fasting)
Result:
104 mg/dL
Meaning:
Slightly high compared with the listed reference range

7. Total Cholesterol
Result:
218 mg/dL
Meaning:
Slightly high

8. Urine Protein (ACR)
Result:
18 mg/g
Meaning:
Normal / within listed range

What Does This Mean for You?

Your main concern is high blood pressure.

If blood pressure remains uncontrolled over time, it can increase the risk of heart disease, stroke, and kidney problems.

However, a single blood-pressure reading alone does not confirm a diagnosis of hypertension. Appropriate repeat measurements or out-of-office readings are needed.

The kidney-related and electrolyte results in this sample are reassuring.

Health Recommendations

- Blood pressure: Check your blood pressure regularly and keep a record.
- Diet: Reduce salt and oily foods and eat more vegetables and fruits.
- Physical activity: Stay physically active according to your health condition and doctor's advice.
- Blood sugar and cholesterol: Continue regular monitoring.
- Medical follow-up: Visit your doctor to review your blood pressure, cholesterol, and blood sugar and discuss whether treatment is needed.

Final Summary

Your sample kidney-related results are reassuring, but your blood pressure, cholesterol, and fasting blood sugar need attention.

Regular monitoring, healthy habits, and appropriate medical care can help manage these cardiovascular risks.`,
  myanmar: `သွေးတိုးရောဂါ ဓာတ်ခွဲစစ်ဆေးမှု အကျဉ်းချုပ်

Patient Name: U KyawAung Moe
Age: 59 years
Sex: Male
Report Type: Hypertension Assessment

ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်

စစ်ဆေးမှုနမူနာရလဒ်များအရ သွေးပေါင်ချိန် မြင့်တက်နေပြီး သွေးတွင်းအဆီဓာတ်နှင့် သွေးချိုဓာတ် အနည်းငယ်မြင့်နေသည်ကို တွေ့ရပါသည်။

ကျောက်ကပ်လုပ်ဆောင်ချက်၊ ဆိုဒီယမ်၊ ပိုတက်စီယမ်နှင့် ဆီးတွင်းပရိုတင်း စစ်ဆေးမှုရလဒ်များမှာ ဖော်ပြထားသော သတ်မှတ်ချက်များအတွင်း ရှိနေပါသည်။

စစ်ဆေးမှုရလဒ်များ

1. သွေးပေါင်ချိန်
ရလဒ်:
158/96 mmHg
အခြေအနေ:
မြင့်နေသည် — အတည်ပြုရန် ထပ်မံတိုင်းတာခြင်း သို့မဟုတ် အိမ်တွင်/ဆေးရုံပြင်ပတွင် တိုင်းတာခြင်း လိုအပ်နိုင်ပါသည်

2. ကျောက်ကပ် (Creatinine)
ရလဒ်:
1.1 mg/dL
အခြေအနေ:
ပုံမှန်အတွင်း

3. ကျောက်ကပ်စစ်ထုတ်နိုင်စွမ်း (eGFR)
ရလဒ်:
76 mL/min/1.73 m²
အခြေအနေ:
သတ်မှတ်အတွင်း

4. ဆိုဒီယမ်
ရလဒ်:
140 mmol/L
အခြေအနေ:
ပုံမှန်

5. ပိုတက်စီယမ်
ရလဒ်:
4.2 mmol/L
အခြေအနေ:
ပုံမှန်

6. အစာမစားမီ သွေးချို
ရလဒ်:
104 mg/dL
အခြေအနေ:
ဖော်ပြထားသော သတ်မှတ်ချက်ထက် အနည်းငယ်မြင့်

7. သွေးတွင်းအဆီဓာတ်
ရလဒ်:
218 mg/dL
အခြေအနေ:
အနည်းငယ်မြင့်

8. ဆီးတွင်းပရိုတင်း (ACR)
ရလဒ်:
18 mg/g
အခြေအနေ:
ပုံမှန်အတွင်း

လူနာအတွက် နားလည်လွယ်သော ရှင်းလင်းချက်

ဦးကျော်အောင်မိုး၏ နမူနာရလဒ်အရ အဓိကဂရုစိုက်ရမည့်အချက်မှာ သွေးပေါင်ချိန်မြင့်တက်နေခြင်း ဖြစ်ပါသည်။

သွေးပေါင်ချိန်ကို အချိန်ကြာမြင့်စွာ မထိန်းချုပ်နိုင်ပါက နှလုံး၊ ဦးနှောက်နှင့် ကျောက်ကပ်တို့ကို ထိခိုက်စေနိုင်ပါသည်။

သို့သော် တစ်ကြိမ်တည်းတိုင်းတာထားသော သွေးပေါင်ချိန်ဖြင့် သွေးတိုးရောဂါကို အတည်မပြုသင့်ပါ။

ထပ်မံတိုင်းတာခြင်း သို့မဟုတ် အိမ်တွင်/ဆေးရုံပြင်ပတွင် သွေးပေါင်ချိန်တိုင်းတာခြင်း လိုအပ်နိုင်ပါသည်။

နမူနာစစ်ဆေးမှုတွင် ကျောက်ကပ်နှင့် ဆားဓာတ်ဆိုင်ရာ ရလဒ်များမှာ သတ်မှတ်ချက်အတွင်း ရှိနေပါသည်။

ကျန်းမာရေးအကြံပြုချက်များ

- သွေးပေါင်ချိန်: ပုံမှန်တိုင်းတာပြီး မှတ်တမ်းတင်ထားပါ။
- အစားအသောက်: ဆား၊ အဆီများသော အစားအစာများကို လျှော့စားပြီး ဟင်းသီးဟင်းရွက်နှင့် သစ်သီးများ ပိုမိုစားသုံးပါ။
- လေ့ကျင့်ခန်း: ကျန်းမာရေးအခြေအနေနှင့် ကိုက်ညီသော ကိုယ်လက်လှုပ်ရှားမှု ပြုလုပ်ပါ။
- သွေးချိုနှင့် သွေးတွင်းအဆီ: ပုံမှန်ပြန်လည်စစ်ဆေးပါ။
- ဆရာဝန်နှင့်ပြသခြင်း: သွေးပေါင်ချိန်၊ သွေးချိုနှင့် သွေးတွင်းအဆီဓာတ်ကို ပြန်လည်သုံးသပ်ပြီး လိုအပ်သောကုသမှုအတွက် ဆရာဝန်နှင့် ဆွေးနွေးပါ။

နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်

ကျောက်ကပ်ဆိုင်ရာ နမူနာရလဒ်များမှာ အားရဖွယ်ဖြစ်သော်လည်း သွေးပေါင်ချိန်၊ သွေးချိုနှင့် သွေးတွင်းအဆီဓာတ်ကို အထူးဂရုစိုက်ရန် လိုအပ်ပါသည်။

ပုံမှန်စောင့်ကြည့်ခြင်း၊ ကျန်းမာရေးနှင့်ညီညွတ်သော နေထိုင်စားသောက်မှုပုံစံနှင့် သင့်တော်သော ဆေးကုသမှုတို့ဖြင့် အဆိုပါကျန်းမာရေးအန္တရာယ်များကို ထိန်းချုပ်နိုင်ပါသည်။`,
})

const diabetesLabReport = Object.freeze({
  key: 'diabetes lab report', title: 'Diabetes Lab Report', titleEnglish: 'Diabetes Lab Report Summary',
  titleMyanmar: 'ဆီးချိုရောဂါ ဓာတ်ခွဲစစ်ဆေးမှု အကျဉ်းချုပ်',
  patient: 'Daw Ei Ei San', age: '49 years', sex: 'Female', reportType: 'Diabetes Screening & Monitoring',
  english: `Diabetes Lab Report Summary

Patient Name: Daw Ei Ei San
Age: 49 years
Sex: Female
Report Type: Diabetes Screening & Monitoring

Overall Health Summary

Your sample laboratory results show that your blood sugar levels are higher than normal.

Your fasting blood sugar and HbA1c are in the diabetes range.

Your kidney-related test results are within the listed reference ranges, but your cholesterol is slightly elevated.

Understanding Your Results

1. Fasting Blood Sugar
Result:
154 mg/dL
Meaning:
High

2. HbA1c (3-month average)
Result:
7.4%
Meaning:
High

3. 2-Hour Blood Sugar
Result:
212 mg/dL
Meaning:
High

4. Kidney Function (Creatinine)
Result:
0.9 mg/dL
Meaning:
Within range

5. eGFR
Result:
83 mL/min/1.73 m²
Meaning:
Within report range

6. Urine Protein (ACR)
Result:
21 mg/g
Meaning:
Normal / within listed range

7. Total Cholesterol
Result:
205 mg/dL
Meaning:
Slightly high

What Does This Mean for You?

Your blood sugar results suggest diabetes-range glucose levels.

HbA1c of 7.4% indicates that your average blood sugar over approximately the past three months has been elevated.

Your kidney-related results are reassuring, but your cholesterol needs attention.

Health Recommendations

- Reduce sugary drinks, sweets, and excessive refined carbohydrates.
- Eat balanced meals with vegetables and fiber.
- Exercise regularly according to your health condition.
- Monitor your blood sugar as advised by your doctor.
- Visit your doctor to review these results and discuss appropriate treatment.

Final Summary

Your main concern is elevated blood sugar.

With proper medical care, healthy eating, regular activity, and monitoring, diabetes can often be managed effectively.`,
  myanmar: `ဆီးချိုရောဂါ ဓာတ်ခွဲစစ်ဆေးမှု အကျဉ်းချုပ်

Patient Name: Daw Ei Ei San
Age: 49 years
Sex: Female
Report Type: Diabetes Screening & Monitoring

ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်

နမူနာဓာတ်ခွဲစစ်ဆေးမှုရလဒ်များအရ သွေးတွင်းသကြားဓာတ် ပုံမှန်ထက် မြင့်တက်နေပြီး ဆီးချိုရောဂါရှိသူများတွင် တွေ့ရတတ်သော အဆင့်သို့ ရောက်ရှိနေပါသည်။

ပြီးခဲ့သော ၃ လခန့်အတွင်း သွေးချိုပျမ်းမျှအခြေအနေကို ပြသသော HbA1c တန်ဖိုးမှာလည်း မြင့်တက်နေပါသည်။

ကျောက်ကပ်ဆိုင်ရာ စစ်ဆေးမှုရလဒ်များမှာ သတ်မှတ်ချက်အတွင်း ရှိနေသော်လည်း သွေးတွင်းအဆီဓာတ် အနည်းငယ်မြင့်နေပါသည်။

စစ်ဆေးမှုရလဒ်များ

1. အစာမစားမီ သွေးချို
ရလဒ်:
154 mg/dL
အခြေအနေ:
မြင့်နေသည်

2. ၃ လပျမ်းမျှသွေးချို (HbA1c)
ရလဒ်:
7.4%
အခြေအနေ:
မြင့်နေသည်

3. ၂ နာရီ သွေးချို
ရလဒ်:
212 mg/dL
အခြေအနေ:
မြင့်နေသည်

4. ကျောက်ကပ် (Creatinine)
ရလဒ်:
0.9 mg/dL
အခြေအနေ:
ပုံမှန်အတွင်း

5. ကျောက်ကပ်စစ်ထုတ်နိုင်စွမ်း (eGFR)
ရလဒ်:
83 mL/min/1.73 m²
အခြေအနေ:
သတ်မှတ်အတွင်း

6. ဆီးတွင်းပရိုတင်း (ACR)
ရလဒ်:
21 mg/g
အခြေအနေ:
ပုံမှန်အတွင်း

7. သွေးတွင်းအဆီဓာတ်
ရလဒ်:
205 mg/dL
အခြေအနေ:
အနည်းငယ်မြင့်

လူနာအတွက် နားလည်လွယ်သော ရှင်းလင်းချက်

ဒေါ်အိအိစံ၏ နမူနာရလဒ်တွင် အဓိကဂရုစိုက်ရန် လိုအပ်သောအချက်မှာ သွေးတွင်းသကြားဓာတ် မြင့်တက်နေခြင်း ဖြစ်ပါသည်။

သွေးချိုဓာတ်ကို အချိန်ကြာမြင့်စွာ မထိန်းချုပ်နိုင်ပါက နှလုံး၊ မျက်စိ၊ ကျောက်ကပ်နှင့် အာရုံကြောများကို ထိခိုက်စေနိုင်ပါသည်။

သို့သော် နမူနာစစ်ဆေးမှုအရ ကျောက်ကပ်ဆိုင်ရာ ရလဒ်များမှာ သတ်မှတ်ချက်အတွင်း ရှိနေပါသည်။

ကျန်းမာရေးအကြံပြုချက်များ

- အစားအသောက်: အချိုရည်၊ မုန့်ချိုနှင့် သကြားပါဝင်မှုများသော အစားအစာများကို လျှော့စားပါ။
- ထမင်းစားသုံးမှု: ထမင်းပမာဏကို သင့်တင့်စွာစားပြီး ဟင်းသီးဟင်းရွက်များ ပိုမိုစားသုံးပါ။
- ကိုယ်လက်လှုပ်ရှားမှု: ကျန်းမာရေးအခြေအနေနှင့် ကိုက်ညီသော လေ့ကျင့်ခန်းများ ပြုလုပ်ပါ။
- သွေးချိုစစ်ဆေးခြင်း: ဆရာဝန်ညွှန်ကြားချက်အတိုင်း ပုံမှန်စစ်ဆေးပါ။
- ဆရာဝန်နှင့်ပြသခြင်း: လိုအပ်သော ဆေးဝါးကုသမှုနှင့် သွေးချိုထိန်းချုပ်ရေးအစီအစဉ်ကို ဆွေးနွေးပါ။

နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်

သွေးချိုဓာတ်နှင့် သွေးတွင်းအဆီဓာတ်ကို အထူးဂရုစိုက်ရန် လိုအပ်ပါသည်။

ကျန်းမာရေးနှင့်ညီညွတ်သော အစားအသောက်များ စားသုံးခြင်း၊ ပုံမှန်လေ့ကျင့်ခန်းလုပ်ခြင်းနှင့် ဆရာဝန်၏ ညွှန်ကြားချက်များကို လိုက်နာခြင်းဖြင့် ဆီးချိုရောဂါနှင့် ဆက်စပ်သော ကျန်းမာရေးအန္တရာယ်များကို လျှော့ချနိုင်ပါသည်။`,
})

const coronaryCt = Object.freeze({
  key: 'coronary ct', title: 'Coronary CT', titleEnglish: 'Coronary Artery Imaging Report Summary',
  titleMyanmar: 'နှလုံးသွေးကြော CT စစ်ဆေးမှုရလဒ် အကျဉ်းချုပ်',
  patient: 'U KyawAung Moe', age: '59 years', sex: 'Male', reportType: 'CT Coronary Angiography (CCTA)',
  english: `Coronary Artery Imaging Report Summary

Patient Name: U KyawAung Moe
Age: 59 years
Sex: Male
Examination: CT Coronary Angiography (CCTA)

Overall Health Summary

Your sample CT scan report shows mild plaque buildup in the arteries that supply blood to your heart.

One of the main arteries, called the Left Anterior Descending (LAD) artery, has approximately 20–30% narrowing.

The reassuring finding is that no significant blockage of the coronary arteries is described.

Your heart size appears normal, and no fluid accumulation around the heart is reported.

Understanding Your Results

1. Left Main Artery
Result:
No significant narrowing
Meaning:
Reassuring

2. LAD Artery
Result:
20–30% narrowing
Meaning:
Mild plaque buildup

3. Left Circumflex Artery
Result:
Mild plaque
Meaning:
No major blockage described

4. Right Coronary Artery
Result:
Minimal wall irregularity
Meaning:
No significant narrowing

5. Heart Size
Result:
Normal
Meaning:
Reassuring

6. Fluid Around Heart
Result:
None
Meaning:
Normal finding

What Does This Mean for You?

Your example report suggests an early or mild form of coronary artery disease.

Plaque is a buildup of fatty substances, cholesterol, and sometimes calcium inside artery walls.

Over time, plaque can increase the risk of heart problems.

Although the narrowing described is mild, it is important to control your blood pressure, cholesterol, and other cardiovascular risk factors.

Health Recommendations

- Heart-healthy diet: Reduce saturated fats, excess salt, and highly processed foods.
- Blood pressure: Monitor regularly and follow prescribed treatment.
- Cholesterol: Discuss your cholesterol levels and whether cholesterol-lowering medication is appropriate with your doctor.
- Physical activity: Exercise regularly according to your doctor's advice.
- Smoking: Avoid smoking and tobacco exposure.
- Follow-up: Consult a cardiologist to review your symptoms and cardiovascular risk.

Final Summary

Your sample report describes mild coronary artery plaque without a major blockage.

The findings are not described as severe, but plaque can still be associated with cardiovascular risk.

Regular medical follow-up and healthy lifestyle habits are important for protecting your heart.`,
  myanmar: `နှလုံးသွေးကြော CT စစ်ဆေးမှုရလဒ် အကျဉ်းချုပ်

Patient Name: U KyawAung Moe
Age: 59 years
Sex: Male
Examination: CT Coronary Angiography (CCTA)

ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်

နမူနာ CT စစ်ဆေးမှုရလဒ်အရ နှလုံးသို့ သွေးပို့ဆောင်ပေးသော သွေးကြောအချို့တွင် အဆီနှင့် ကယ်လ်စီယမ်အနည်များ အနည်းငယ်စုဆောင်းနေသည်ဟု ဖော်ပြထားပါသည်။

အထူးသဖြင့် နှလုံး၏ အဓိကသွေးကြောတစ်ခုဖြစ်သော LAD သွေးကြောတွင် ၂၀% မှ ၃၀% ခန့် ကျဉ်းမြောင်းနေသည်ဟု နမူနာတွင် ဖော်ပြထားပါသည်။

သို့သော် သွေးစီးဆင်းမှုကို သိသိသာသာ ပိတ်ဆို့စေနိုင်သော ပြင်းထန်သည့် သွေးကြောကျဉ်းမြောင်းမှု မတွေ့ရှိရဟု ဖော်ပြထားပါသည်။

နှလုံးအရွယ်အစားမှာလည်း ပုံမှန်ဖြစ်ပြီး နှလုံးပတ်လည်တွင် အရည်စုဆောင်းမှု မရှိကြောင်း ဖော်ပြထားပါသည်။

စစ်ဆေးမှုရလဒ်များ

1. ဘယ်ဘက်အဓိကသွေးကြော (Left Main)
ရလဒ်:
သိသာသောကျဉ်းမြောင်းမှုမရှိ
အခြေအနေ:
ကောင်းမွန်

2. LAD သွေးကြော
ရလဒ်:
၂၀–၃၀% ကျဉ်း
အခြေအနေ:
အနည်းငယ်ကျဉ်း

3. LCx သွေးကြော
ရလဒ်:
အနည်အနည်းငယ်ရှိ
အခြေအနေ:
ပြင်းထန်မှုမရှိ

4. RCA သွေးကြော
ရလဒ်:
သွေးကြောနံရံ အနည်းငယ်ပြောင်းလဲ
အခြေအနေ:
သိသာသောကျဉ်းမြောင်းမှုမရှိ

5. နှလုံးအရွယ်အစား
ရလဒ်:
ပုံမှန်
အခြေအနေ:
ကောင်းမွန်

6. နှလုံးပတ်လည် အရည်စုဆောင်းမှု
ရလဒ်:
မရှိ
အခြေအနေ:
ပုံမှန်

လူနာအတွက် နားလည်လွယ်သော ရှင်းလင်းချက်

နှလုံးသွေးကြောများသည် နှလုံးကြွက်သားများအတွက် လိုအပ်သော သွေးနှင့် အောက်ဆီဂျင်ကို ပို့ဆောင်ပေးပါသည်။

သွေးကြောနံရံများတွင် အဆီ၊ ကိုလက်စထရောနှင့် ကယ်လ်စီယမ်အနည်များ စုဆောင်းလာပါက သွေးကြောများ ကျဉ်းမြောင်းလာနိုင်ပါသည်။

ဤနမူနာရလဒ်တွင် အဓိကသွေးကြောတစ်ခု၌ အနည်းငယ်ကျဉ်းမြောင်းမှုရှိကြောင်း ဖော်ပြထားသော်လည်း သွေးကြောအကြီးအကျယ် ပိတ်ဆို့နေသည့်အခြေအနေမျိုး မဖော်ပြထားပါ။

သို့သော် သွေးကြောကျဉ်းမြောင်းမှု အနည်းငယ်သာရှိသည်ဆိုသော်လည်း နှလုံးရောဂါဖြစ်နိုင်ခြေကို လျှော့ချရန် ဂရုစိုက်ဖို့လိုအပ်ပါသည်။

ကျန်းမာရေးအကြံပြုချက်များ

- အစားအသောက်: အဆီများသောအစားအစာ၊ ဆားနှင့် ပြုပြင်ထုတ်လုပ်ထားသော အစားအစာများကို လျှော့စားပါ။
- သွေးပေါင်ချိန်: ပုံမှန်တိုင်းတာပြီး ဆရာဝန်ညွှန်ကြားထားသောဆေးများကို စနစ်တကျသောက်ပါ။
- သွေးတွင်းအဆီဓာတ်: ပုံမှန်စစ်ဆေးပြီး လိုအပ်ပါက ဆရာဝန်နှင့် ဆေးဝါးကုသမှုအကြောင်း ဆွေးနွေးပါ။
- ကိုယ်လက်လှုပ်ရှားမှု: ကျန်းမာရေးအခြေအနေနှင့် ကိုက်ညီသော လေ့ကျင့်ခန်းများကို ပုံမှန်ပြုလုပ်ပါ။
- ဆေးလိပ်: ဆေးလိပ်သောက်ခြင်းနှင့် ဆေးလိပ်ငွေ့ထိတွေ့ခြင်းကို ရှောင်ကြဉ်ပါ။
- နှလုံးအထူးကုဆရာဝန်: နှလုံးနှင့် သွေးကြောကျန်းမာရေးအခြေအနေကို စစ်ဆေးတိုင်ပင်ပါ။

နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်

ဤနမူနာရလဒ်အရ နှလုံးသွေးကြောအချို့တွင် အနည်အနည်းငယ်စုဆောင်းနေပြီး သွေးကြောအကြီးအကျယ်ပိတ်ဆို့မှု မဖော်ပြထားပါ။

သို့သော် သွေးပေါင်ချိန်နှင့် သွေးတွင်းအဆီဓာတ်ကို စနစ်တကျထိန်းချုပ်ခြင်း၊ ကျန်းမာရေးနှင့်ညီညွတ်သော အစားအသောက်များစားသုံးခြင်း၊ ဆရာဝန်နှင့် ပုံမှန်ပြသခြင်းတို့သည် နှလုံးကျန်းမာရေးအတွက် အရေးကြီးပါသည်။`,
})

const cervicalSpine = Object.freeze({
  key: 'cervical spine', title: 'Cervical Spine', titleEnglish: 'Cervical Spondylosis Imaging Report Summary',
  titleMyanmar: 'လည်ပင်းကျီးပေါင်းရောဂါ X-ray စစ်ဆေးမှု အကျဉ်းချုပ်',
  patient: 'Nandar Kyaw', age: '22 years', sex: 'Female', reportType: 'Cervical Spine X-ray',
  english: `Cervical Spondylosis Imaging Report Summary

Patient Name: Nandar Kyaw
Age: 22 years
Sex: Female
Examination: Cervical Spine X-ray

Overall Health Summary

Your sample X-ray report shows mild changes in the bones and discs of your neck, particularly between the C5 and C6 vertebrae.

These changes are described as possible early cervical spondylosis, a condition involving wear and tear of the cervical spine.

The normal curve of your neck is also slightly straightened, which may be related to muscle tension or posture.

The reassuring finding is that no fracture, dislocation, or major bone abnormality is described.

Understanding Your Results

1. Neck curvature
Result:
Mild straightening
Meaning:
Normal neck curve is reduced

2. C5–C6 disc space
Result:
Slightly narrowed
Meaning:
Mild disc-space change

3. Bone spurs
Result:
Small osteophytes
Meaning:
Mild bony changes

4. Vertebral alignment
Result:
Preserved
Meaning:
Bones remain properly aligned

5. Fracture / Dislocation
Result:
None identified
Meaning:
No acute bone injury described

6. Surrounding soft tissues
Result:
Normal appearance
Meaning:
No unusual swelling described

What Does This Mean for You?

Your example report suggests mild early changes in the cervical spine.

These changes may be associated with neck pain, stiffness, or discomfort when sitting or looking down for long periods.

However, X-ray changes do not always explain neck pain, and cervical spondylosis is less common at age 22.

A doctor should evaluate your symptoms before confirming a diagnosis.

Health Recommendations

- Good posture: Keep your computer screen at eye level and avoid bending your neck forward for long periods.
- Regular breaks: Take short movement breaks while studying or using a computer.
- Gentle movement: Perform comfortable neck exercises as advised by a healthcare professional.
- Physical therapy: Consider physiotherapy if neck pain or stiffness continues.
- Medical follow-up: Consult a doctor if symptoms persist or worsen.

Seek urgent medical evaluation if you develop progressive arm or leg weakness, difficulty walking, or new loss of bladder or bowel control.

Final Summary

Your sample report describes mild changes at C5–C6 and slight straightening of the neck's normal curve.

No acute bone injury is described.

These findings are not necessarily serious, but persistent symptoms should be assessed by a healthcare professional.`,
  myanmar: `လည်ပင်းကျီးပေါင်းရောဂါ X-ray စစ်ဆေးမှု အကျဉ်းချုပ်

Patient Name: Nandar Kyaw
Age: 22 years
Sex: Female
Examination: Cervical Spine X-ray

ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်

နမူနာ X-ray စစ်ဆေးမှုရလဒ်အရ လည်ပင်းကျောရိုး C5 နှင့် C6 အကြားရှိ Disc နှင့် အရိုးများတွင် အနည်းငယ်ပြောင်းလဲမှုများ တွေ့ရသည်ဟု ဖော်ပြထားပါသည်။

အဆိုပါပြောင်းလဲမှုများသည် လည်ပင်းကျီးပေါင်းရောဂါ (Cervical Spondylosis) ၏ အစောပိုင်းလက္ခဏာများနှင့် ဆင်တူနိုင်ပါသည်။

ထို့အပြင် လည်ပင်းကျောရိုး၏ ပုံမှန်အကွေးမှာ အနည်းငယ်ဖြောင့်နေပြီး ကြွက်သားတင်းမာမှု သို့မဟုတ် ကိုယ်ဟန်အနေအထားနှင့် ဆက်စပ်နိုင်ပါသည်။

သို့သော် အရိုးကျိုးခြင်း၊ အဆစ်လွဲခြင်းနှင့် ပြင်းထန်သော အရိုးထိခိုက်မှုများကို နမူနာရလဒ်တွင် မဖော်ပြထားပါ။

စစ်ဆေးမှုရလဒ်များ

1. လည်ပင်းကျောရိုးအကွေး
ရလဒ်:
အနည်းငယ်ဖြောင့်
အခြေအနေ:
ပုံမှန်အကွေး လျော့နည်း

2. C5–C6 Disc
ရလဒ်:
အနည်းငယ်ကျဉ်း
အခြေအနေ:
Disc နေရာ လျော့နည်း

3. အရိုးငုတ်ငယ်များ
ရလဒ်:
အနည်းငယ်ရှိ
အခြေအနေ:
အရိုးပြောင်းလဲမှု

4. ကျောရိုးတန်းညီမှု
ရလဒ်:
ပုံမှန်
အခြေအနေ:
ကောင်းမွန်

5. အရိုးကျိုး / အဆစ်လွဲ
ရလဒ်:
မတွေ့ရှိ
အခြေအနေ:
ထိခိုက်ဒဏ်ရာ မဖော်ပြထား

6. ပတ်ဝန်းကျင်တစ်ရှူး
ရလဒ်:
ထူးခြားမှုမရှိ
အခြေအနေ:
ပုံမှန်

လူနာအတွက် နားလည်လွယ်သော ရှင်းလင်းချက်

လည်ပင်းကျီးပေါင်းရောဂါဆိုသည်မှာ လည်ပင်းကျောရိုးများနှင့် အရိုးကြားရှိ Disc များတွင် တဖြည်းဖြည်း ပြောင်းလဲမှုဖြစ်ပေါ်လာခြင်းကို ဆိုလိုပါသည်။

ဤအခြေအနေမျိုးသည် လည်ပင်းနာကျင်ခြင်း၊ တောင့်တင်းခြင်းနှင့် လည်ပင်းလှုပ်ရှားရာတွင် မသက်မသာဖြစ်ခြင်းတို့နှင့် ဆက်စပ်နိုင်ပါသည်။

သို့သော် အသက် ၂၂ နှစ်အရွယ်တွင် လည်ပင်းကျီးပေါင်းရောဂါသည် အတွေ့နည်းသဖြင့် X-ray နမူနာရလဒ်တစ်ခုတည်းဖြင့် ရောဂါရှိကြောင်း မသတ်မှတ်သင့်ပါ။

ကျန်းမာရေးအကြံပြုချက်များ

- ထိုင်ပုံထိုင်နည်း: ကွန်ပျူတာအသုံးပြုသည့်အခါ မျက်နှာပြင်ကို မျက်လုံးအမြင့်နှင့် သင့်တင့်စွာထားပါ။
- ဖုန်းအသုံးပြုခြင်း: လည်ပင်းကို အချိန်ကြာမြင့်စွာ ငုံ့မထားပါနှင့်။
- အနားယူခြင်း: စာကြည့်ခြင်း၊ ကွန်ပျူတာအသုံးပြုခြင်းတို့တွင် ကြားကာလအလိုက် အနားယူပါ။
- လည်ပင်းလေ့ကျင့်ခန်း: နာကျင်မှုမဖြစ်စေသော လှုပ်ရှားမှုများကို ကျန်းမာရေးပညာရှင်၏ အကြံပြုချက်အတိုင်း ပြုလုပ်ပါ။
- ဆရာဝန်နှင့်ပြသခြင်း: လည်ပင်းနာကျင်မှု မသက်သာပါက ဆရာဝန် သို့မဟုတ် Physiotherapist နှင့် တိုင်ပင်ပါ။

လက်ခြေအားနည်းမှု တိုးလာခြင်း၊ လမ်းလျှောက်ရခက်ခြင်း၊ ဆီးဝမ်းထိန်းချုပ်မှု ပြဿနာအသစ်ဖြစ်ပေါ်ခြင်းတို့ရှိပါက အရေးပေါ်ဆေးကုသမှုခံယူသင့်ပါသည်။

နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်

နမူနာစစ်ဆေးမှုရလဒ်အရ လည်ပင်းကျောရိုး C5–C6 တွင် အနည်းငယ်ပြောင်းလဲမှုရှိပြီး လည်ပင်း၏ ပုံမှန်အကွေးလည်း အနည်းငယ်လျော့နည်းနေသည်ဟု ဖော်ပြထားပါသည်။

ပြင်းထန်သော အရိုးထိခိုက်မှုမျိုး မဖော်ပြထားသော်လည်း နာကျင်မှုဆက်လက်ရှိနေပါက ဆရာဝန်နှင့် စစ်ဆေးတိုင်ပင်သင့်ပါသည်။`,
})

const medicalPrescription = Object.freeze({
  key: 'medical prescription', title: 'Medical Prescription', summaryType: 'prescription',
  titleEnglish: 'Cervical Spondylosis Prescription Summary', titleMyanmar: 'လည်ပင်းကျီးပေါင်းရောဂါ ဆေးညွှန်းနှင့် ကုသမှုအစီအစဉ် အကျဉ်းချုပ်',
  patient: 'Nandar Kyaw', age: '22 years', sex: 'Female', reportType: 'Prescription / Treatment Plan', condition: 'Cervical Spondylosis / Neck Pain',
  english: `Cervical Spondylosis Prescription Summary

Patient Name: Nandar Kyaw
Age: 22 years
Sex: Female
Condition: Cervical Spondylosis / Neck Pain
Document Type: Prescription / Treatment Plan

Overall Treatment Summary

Your sample prescription describes a treatment plan for neck pain and stiffness associated with cervical spondylosis.

The plan includes pain-relief medication, a topical anti-inflammatory gel, vitamin supplementation, and physiotherapy advice.

The main goal is to reduce neck pain, improve movement, and prevent symptoms from worsening.

Understanding Your Medications

1. Paracetamol 500 mg
Instructions: Take 1 tablet by mouth every 8 hours as needed for pain, for 5 days.
Purpose: Helps relieve pain.

2. Diclofenac Gel
Instructions: Apply a thin layer to the painful neck area 3 times daily for 7 days.
Purpose: Helps reduce local pain and inflammation.

3. Vitamin B Complex
Instructions: Take 1 tablet once daily after food for 14 days.
Purpose: Vitamin supplementation.
Note: Vitamin B complex is not an established treatment for cervical spondylosis itself.

Physiotherapy and Daily Care

- Warm compress: Apply warmth to the neck 2–3 times daily to help relieve stiffness.
- Good posture: Keep your neck in a comfortable position while studying, using your phone, or working on a computer.
- Gentle exercises: Perform comfortable neck stretches and movement exercises.
- Regular breaks: Avoid keeping your neck bent forward for long periods.
- Avoid heavy lifting: Limit activities that worsen neck pain.

Follow-Up and Warning Signs

If neck pain or stiffness continues, the sample plan recommends a follow-up appointment within 1–2 weeks.

Seek medical attention sooner if pain worsens, numbness develops, or you experience weakness.

New difficulty walking or loss of bladder or bowel control requires urgent assessment.

Final Summary

The sample prescription focuses on pain relief, better neck posture, gentle movement, and physiotherapy.

Medicines may help relieve symptoms, while appropriate physical rehabilitation can support longer-term improvement.`,
  myanmar: `လည်ပင်းကျီးပေါင်းရောဂါ ဆေးညွှန်းနှင့် ကုသမှုအစီအစဉ် အကျဉ်းချုပ်

Patient Name: Nandar Kyaw
Age: 22 years
Sex: Female
Condition: Cervical Spondylosis / Neck Pain
Document Type: Prescription / Treatment Plan

ကျန်းမာရေးနှင့် ကုသမှုအခြေအနေ အကျဉ်းချုပ်

ဤနမူနာဆေးညွှန်းတွင် လည်ပင်းကျီးပေါင်းရောဂါ (Cervical Spondylosis) နှင့် ဆက်စပ်သော လည်ပင်းနာကျင်ခြင်း၊ တောင့်တင်းခြင်းတို့ကို သက်သာစေရန် ကုသမှုအစီအစဉ် ဖော်ပြထားပါသည်။

ကုသမှုတွင် အကိုက်အခဲပျောက်ဆေး၊ လိမ်းဆေး၊ ဗီတာမင်အားဖြည့်ဆေးနှင့် Physiotherapy လေ့ကျင့်ခန်းများ ပါဝင်ပါသည်။

အဓိကရည်ရွယ်ချက်မှာ လည်ပင်းနာကျင်မှုလျော့နည်းစေရန်၊ လည်ပင်းလှုပ်ရှားမှုကောင်းမွန်စေရန်နှင့် နာကျင်မှု ပိုမိုမဆိုးရွားစေရန် ဖြစ်ပါသည်။

ဆေးဝါးများအကြောင်း နားလည်လွယ်သော ရှင်းလင်းချက်

1. Paracetamol 500 mg — အကိုက်အခဲပျောက်ဆေး
Instructions: နာကျင်မှုရှိပါက ၈ နာရီခြားတစ်ကြိမ်၊ တစ်လုံးစီ၊ ၅ ရက်အထိ သောက်ရန် ဖော်ပြထားပါသည်။
Purpose: လည်ပင်းနာကျင်မှုကို သက်သာစေပါသည်။

2. Diclofenac Gel — အကိုက်အခဲသက်သာစေသော လိမ်းဆေး
Instructions: နာကျင်သော လည်ပင်းနေရာကို တစ်နေ့ ၃ ကြိမ်၊ ၇ ရက်ကြာ ပါးပါးလိမ်းရန် ဖော်ပြထားပါသည်။
Purpose: နာကျင်မှုနှင့် ရောင်ရမ်းမှုကို လျော့နည်းစေနိုင်ပါသည်။

3. Vitamin B Complex — ဗီတာမင်အားဖြည့်ဆေး
Instructions: အစာစားပြီး တစ်နေ့တစ်လုံး၊ ၁၄ ရက်ကြာ သောက်ရန် ဖော်ပြထားပါသည်။
Purpose: ဗီတာမင် B အမျိုးအစားများ ဖြည့်စွက်ပေးရန်ဖြစ်ပြီး လည်ပင်းကျီးပေါင်းရောဂါကို တိုက်ရိုက်ကုသသည့်ဆေး မဟုတ်ပါ။

နေ့စဉ်လိုက်နာသင့်သော အကြံပြုချက်များ

- အနွေးကပ်ခြင်း: လည်ပင်းတောင့်တင်းမှု သက်သာစေရန် တစ်နေ့ ၂–၃ ကြိမ် အနွေးကပ်ပေးနိုင်ပါသည်။
- ထိုင်ပုံထိုင်နည်း: ဖုန်းနှင့် ကွန်ပျူတာအသုံးပြုချိန်တွင် လည်ပင်းကို အချိန်ကြာကြာ ငုံ့မထားပါနှင့်။
- လည်ပင်းလေ့ကျင့်ခန်း: နာကျင်မှုမဖြစ်စေသော လည်ပင်းလှုပ်ရှားမှုများကို ဖြည်းဖြည်းပြုလုပ်ပါ။
- အနားယူခြင်း: စာကြည့်ခြင်း၊ ကွန်ပျူတာအသုံးပြုခြင်းတို့တွင် ကြားကာလအလိုက် အနားယူပါ။
- အလေးအပင်မခြင်း: လည်ပင်းနာကျင်မှုကို ပိုဆိုးစေသော အလေးအပင်မခြင်းနှင့် လှုပ်ရှားမှုများကို ရှောင်ကြဉ်ပါ။

ပြန်လည်စစ်ဆေးရန်နှင့် သတိပြုရန်

နမူနာကုသမှုအစီအစဉ်အရ လည်ပင်းနာကျင်မှု မသက်သာပါက ၁ ပတ်မှ ၂ ပတ်အတွင်း ဆရာဝန်နှင့် ပြန်လည်ပြသရန် ဖော်ပြထားပါသည်။

လက်ထုံကျင်ခြင်း၊ လက်ခြေအားနည်းခြင်း သို့မဟုတ် နာကျင်မှုပိုဆိုးလာခြင်းတို့ရှိပါက ဆရာဝန်နှင့် စောစီးစွာ ပြသသင့်ပါသည်။

လမ်းလျှောက်ရခက်ခြင်း သို့မဟုတ် ဆီးဝမ်းထိန်းချုပ်မှု ပြဿနာအသစ်ဖြစ်ပေါ်ပါက အရေးပေါ်ဆေးကုသမှုခံယူပါ။

နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်

ဤနမူနာဆေးညွှန်း၏ အဓိကရည်ရွယ်ချက်မှာ လည်ပင်းနာကျင်မှုကို သက်သာစေခြင်း၊ မှန်ကန်သော ကိုယ်ဟန်အနေအထားကို ထိန်းသိမ်းခြင်းနှင့် Physiotherapy ဖြင့် လည်ပင်းလှုပ်ရှားမှု ကောင်းမွန်စေခြင်း ဖြစ်ပါသည်။

ဆေးဝါးများက နာကျင်မှုကို ယာယီသက်သာစေနိုင်သော်လည်း နေ့စဉ်နေထိုင်မှုပုံစံ ပြုပြင်ခြင်းနှင့် သင့်တော်သော လေ့ကျင့်ခန်းများ ပြုလုပ်ခြင်းတို့သည်လည်း အရေးကြီးပါသည်။`,
})

const summaries = Object.freeze({
  [cervicalSpondylosis.key]: cervicalSpondylosis,
  [anemia.key]: anemia,
  'anemia lab report': anemia,
  [jumpersKnee.key]: jumpersKnee,
  [rightKneeMri.key]: rightKneeMri,
  'mri right knee': rightKneeMri,
  [coronaryCt.key]: coronaryCt,
  'ct coronary angiography': coronaryCt,
  'coronary angiography': coronaryCt,
  ccta: coronaryCt,
  [diabetesLabReport.key]: diabetesLabReport,
  'diabetes screening': diabetesLabReport,
  'diabetes screening & monitoring': diabetesLabReport,
  'diabetes monitoring report': diabetesLabReport,
  [hypertensionLabReport.key]: hypertensionLabReport,
  'hypertension assessment': hypertensionLabReport,
  'blood pressure report': hypertensionLabReport,
  [cervicalSpine.key]: cervicalSpine,
  [medicalPrescription.key]: medicalPrescription,
})

export function getPreparedDocumentSummary(titleOrFilename) {
  return summaries[normalizeDocumentTitle(titleOrFilename)] ?? null
}
