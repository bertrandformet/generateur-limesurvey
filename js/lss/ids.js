// Simple incrementing id generator — mirrors gen_lss.py's IdGen.
// Each LSS table with a surrogate key (qid, aid, qaid, gid) needs unique,
// internally-consistent values; LimeSurvey remaps them to real DB ids on
// import, using these only to reconstruct parent/child relationships.
export class IdGen {
  constructor(start = 1) {
    this.n = start;
  }
  next() {
    return this.n++;
  }
}
