/*
 * デモ用サンプルデータ（すべて架空）。金額単位は万円。
 * 「設定・データ」画面から削除・CSV取込で差し替えできます。
 */
(function (global) {
  'use strict';

  // 再現性のある疑似乱数
  let seed = 20261124;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (lo, hi) => Math.round(lo + rnd() * (hi - lo));

  const base = [
    ['山田建設株式会社', '山田 一郎', '建設業', '旧さくら会計事務所'],
    ['株式会社北斗工務店', '北村 健二', '建設業', '旧さくら会計事務所'],
    ['東和土木株式会社', '東 和夫', '建設業', '旧みなと税理士事務所'],
    ['有限会社佐藤設備', '佐藤 誠', '建設業', '旧みなと税理士事務所'],
    ['株式会社丸信電工', '丸山 信也', '建設業', '旧さくら会計事務所'],
    ['株式会社青葉精機', '青木 正', '製造業', '旧さくら会計事務所'],
    ['中央プレス工業株式会社', '中田 浩', '製造業', '旧みなと税理士事務所'],
    ['株式会社ミツワ食品', '三輪 洋子', '製造業', '旧みなと税理士事務所'],
    ['関東ロジ株式会社', '関 隆', '運送業', '旧さくら会計事務所'],
    ['株式会社はやて運輸', '早川 修', '運送業', '旧みなと税理士事務所'],
    ['株式会社炭火やまと', '大和 拓也', '飲食業', '旧さくら会計事務所'],
    ['有限会社そば処いしかわ', '石川 茂', '飲食業', '旧みなと税理士事務所'],
    ['株式会社グランキッチン', '倉田 美咲', '飲食業', '旧さくら会計事務所'],
    ['株式会社さくら介護サービス', '桜井 恵子', '医療・介護', '旧さくら会計事務所'],
    ['医療法人社団 健幸会', '健田 昭', '医療・介護', '旧みなと税理士事務所'],
    ['株式会社ひまわり訪問看護', '日野 真理', '医療・介護', '旧みなと税理士事務所'],
    ['みどり整骨院グループ株式会社', '緑川 大輔', '整骨・治療院', '旧さくら会計事務所'],
    ['株式会社ほぐし堂', '保坂 亮', '整骨・治療院', '旧みなと税理士事務所'],
    ['株式会社ネクストシステムズ', '根岸 翔', 'IT・ソフトウェア', '旧さくら会計事務所'],
    ['株式会社クラウドリンク', '倉本 悠', 'IT・ソフトウェア', '旧みなと税理士事務所'],
    ['株式会社田中商店', '田中 義男', '小売業', '旧さくら会計事務所'],
    ['株式会社フジ薬局', '藤井 和子', '小売業', '旧みなと税理士事務所'],
    ['日本資材販売株式会社', '日高 稔', '卸売業', '旧さくら会計事務所'],
    ['株式会社マルキ水産', '木村 勝', '卸売業', '旧みなと税理士事務所'],
    ['株式会社クリーンワークス', '清水 剛', 'サービス業', '旧さくら会計事務所'],
    ['株式会社ブライトスタッフ', '明石 彩', 'サービス業', '旧みなと税理士事務所'],
    ['株式会社いろは不動産', '井口 達也', '不動産業', '旧さくら会計事務所'],
    ['株式会社ホームライフ管理', '堀 順一', '不動産業', '旧みなと税理士事務所'],
    ['株式会社杉本鉄工所', '杉本 孝', '製造業', '旧さくら会計事務所'],
    ['有限会社大野塗装', '大野 武', '建設業', '旧みなと税理士事務所'],
  ];

  const staffs = ['鈴木', '高橋', '伊藤', '渡辺'];

  const clients = base.map(([company, rep, industry, firm], i) => {
    const repAge = between(38, 76);
    const sales = pick([8000, 12000, 18000, 25000, 35000, 50000, 70000, 95000]) + between(-1500, 1500);
    const margin = rnd() * 0.12 - 0.02;
    const opProfit = Math.round(sales * margin);
    const ordinaryProfit = opProfit + between(-200, 300);
    const employees = Math.max(3, Math.round(sales / between(1500, 3500)));
    const cash = Math.round(sales * (0.08 + rnd() * 0.45));
    const debt = Math.round(sales * rnd() * 0.5);
    const netAssets = Math.round(sales * (rnd() * 0.6 - 0.05));
    const tenureYears = Math.max(2, Math.min(repAge - 28, between(3, 35)));
    const execPayMonthly = pick([60, 80, 100, 120, 150, 200]);
    const successor = repAge >= 55 ? pick(['なし', 'なし', '候補あり', 'あり']) : pick(['未定', 'なし', '候補あり']);
    const office = rnd() < 0.6 ? '賃貸' : '自社所有';
    const rentMonthly = office === '賃貸' ? pick([15, 25, 35, 50, 80, 120]) : 0;
    const vehicles = ['運送業', '建設業'].includes(industry) ? between(4, 40) : between(0, 6);

    return {
      id: 'c' + String(i + 1).padStart(3, '0'),
      company, rep, repAge, industry, firm,
      staff: staffs[i % staffs.length],
      sales, opProfit, ordinaryProfit, employees, cash, debt, netAssets,
      execPayMonthly, tenureYears, successor,
      growth: rnd() < 0.3,
      deathCover: pick([0, 0, 1000, 3000, 5000, 10000]),
      retireReserve: pick([0, 0, 500, 1500, 3000, 6000]),
      nonlife: {
        liability: rnd() < 0.5,
        property: rnd() < 0.6,
        auto: vehicles > 0 && rnd() < 0.7,
        workers: rnd() < 0.35,
        cyber: rnd() < 0.1,
      },
      vehicles, office, rentMonthly,
      status: { life: '未着手', nonlife: '未着手', ma: '未着手', re: '未着手' },
      advisoryFee: Math.round(Math.max(30, Math.min(240, sales / 300 + between(-10, 20)))),
      notes: '',
      lastContact: '',
    };
  });

  // 典型ケースを数件だけ確定値に調整（デモで説明しやすいように）
  Object.assign(clients[0], { repAge: 68, successor: 'なし', opProfit: 4200, ordinaryProfit: 4300, sales: 52000, cash: 18000, netAssets: 21000, deathCover: 3000, retireReserve: 500, execPayMonthly: 150, tenureYears: 32, growth: false });
  Object.assign(clients[18], { repAge: 41, successor: '未定', growth: true, opProfit: 3500, ordinaryProfit: 3600, cash: 15000, office: '賃貸', rentMonthly: 120 });
  Object.assign(clients[14], { repAge: 71, successor: '候補あり', netAssets: 38000, cash: 26000, sales: 60000 });
  clients[0].status = { life: '提案中', nonlife: '提案準備', ma: '提案中', re: '未着手' };
  clients[18].status = { life: '未着手', nonlife: '成約', ma: '提案準備', re: '提案中' };

  global.SAMPLE_CLIENTS = clients;
})(window);
