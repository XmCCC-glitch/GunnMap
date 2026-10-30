import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';
import { createApp, renderPeriods, resolveRoom } from '../web_app.js';
import { evacuationForRoom } from '../evacuation.js';
import { rooms, roomData, ROOT } from '../project.js';
import { renderRooms } from '../map_highlighter.js';
const periods = (building: string, room: string, color = '#0284c7') => [
  { building, room, color },
  ...Array.from({ length: 6 }, () => ({ building: '', room: '', color: '#000000' })),
];

test('N214 variants retain identity and match the older reference group', () => {
 assert.equal(resolveRoom(' Ｎ ', 'Ｒ １４８').building, 'N');
 for (const value of ['N214', 'n214', 'n-214', ' N214 ', 'Ｎ－２１４', 'n—214', 'Ｒ １４８', 'N214 （R 148）']) {
  const room = resolveRoom('N', value);
  assert.equal(room.id, 'R148');
  const evacuation = evacuationForRoom(room);
  assert.equal(evacuation.status, 'mapped');
  assert.equal(evacuation.group, 'black');
  assert.equal(evacuation.reference_label, 'N201-N217');
  assert.match(evacuation.destination, /^Historical reference:/);
  assert.match(evacuation.note, /supplied, unverified older evacuation plan/);
  assert.match(evacuation.note, /follow current school staff directions/i);
 }
});
test('only explicit reference ranges and exact rooms receive historical groups', () => {
 const ranges = [
  ['H', 1, 3, 'red', 'H1-H3'], ['H', 4, 5, 'red', 'H4-H5'],
  ['G', 1, 3, 'red', 'G1-G3'], ['G', 4, 7, 'red', 'G4-G7'],
  ['F', 1, 2, 'red', 'F1-F2'], ['F', 4, 6, 'red', 'F4-F6'],
  ['M', 1, 5, 'blue', 'M1-M5'],
  ['K', 1, 5, 'green', 'K-1-K5'], ['K', 6, 13, 'green', 'K6-K13'],
  ['L', 1, 4, 'green', 'L1-L4'], ['L', 5, 8, 'green', 'L5-L8'],
  ['C', 1, 3, 'green', 'C-1-C3'], ['C', 4, 8, 'green', 'C-4-C8'],
  ['E', 1, 2, 'green', 'E1-E2'],
  ['J', 1, 5, 'black', 'J1 - J5'], ['J', 6, 10, 'black', 'J6- J10'],
  ['N', 101, 117, 'black', 'N101-N117'], ['N', 201, 217, 'black', 'N201-N217'],
 ] as const;
 for (const [building, start, end, group, label] of ranges) {
  for (const number of [start, end]) {
   const evacuation = evacuationForRoom({label: `${building}${number}`, building});
   assert.equal(evacuation.group, group, `${building}${number}`);
   assert.equal(evacuation.reference_label, label, `${building}${number}`);
  }
  for (const number of [start - 1, end + 1]) {
   if (ranges.some(([prefix, from, to]) => prefix === building && number >= from && number <= to)) continue;
   assert.equal(evacuationForRoom({label: `${building}${number}`, building}).status, 'unconfirmed', `${building}${number}`);
  }
 }
 for (const label of ['P105', 'P115', 'P117', 'S101', 'S102', 'S121', 'S147']) {
  assert.equal(evacuationForRoom({label, building: label[0]}).group, 'blue', label);
 }
 for (const [label, building] of [['D-LIB', 'D'], ['A101', 'A'], ['B101', 'B'], ['BG111', 'BG'], ['Titan Gym', 'TG']]) {
  assert.equal(evacuationForRoom({label, building}).group, 'green', label);
 }
});
test('unsupported rooms and building mismatches stay unconfirmed without invented aliases', () => {
 for (const [label, building] of [
  ['E01', 'E'], ['E02', 'E'], ['E03', 'E'], ['F3', 'F'], ['H110', 'H'],
  ['K14', 'K'], ['K100', 'K'], ['N100', 'N'], ['N123', 'N'], ['N200', 'N'], ['N223', 'N'],
  ['P106', 'P'], ['P116', 'P'], ['S103', 'S'],
  ['N214', 'M'], ['A101', 'B'], ['D-LIB', 'A'], ['Bow Gym', 'D'], ['BG111', 'TG'],
  ['LIBRARY', 'D'], ['', 'A'],
 ]) {
  const evacuation = evacuationForRoom({label, building});
  assert.deepEqual([evacuation.status, evacuation.group, evacuation.color, evacuation.short_destination, evacuation.reference_label, evacuation.focus],
   ['unconfirmed', null, null, null, null, null], `${building}/${label}`);
 }
 for (const label of ['E01', 'E02']) assert.match(evacuationForRoom({label, building: 'E'}).note, /correspondence is unconfirmed/);
});
test('reference focus bounds are independent of current classroom map geometry', () => {
 for (const room of rooms) {
  const evacuation = evacuationForRoom(room), focus = evacuation.focus;
  if (!focus) continue;
  assert.ok(focus.x >= 0 && focus.y >= 0 && focus.width > 0 && focus.height > 0);
  assert.ok(focus.x + focus.width <= 1 && focus.y + focus.height <= 1);
  assert.match(evacuation.destination, /^Historical reference:/);
  assert.match(evacuation.note, /follow current school staff directions/i);
 }
 const focus = evacuationForRoom(resolveRoom('N', 'N214')).focus;
 assert.deepEqual(focus, {x:1696/1852,y:380/1156,width:126/1852,height:32/1156});
});
test('renumbered E and K rooms use current identities without reviving retired IDs', () => {
 assert.equal(resolveRoom('E', 'E01').id, 'R153');
 assert.equal(resolveRoom('E', 'E05').id, 'R157');
 assert.equal(resolveRoom('K', 'K3').id, 'R158');
 assert.equal(resolveRoom('K', 'K4').id, 'R159');
 for (const value of ['E09', 'E10', 'E14', 'E15', 'E17', 'R028', 'R029']) {
  assert.throws(() => resolveRoom('E', value), /not found/);
 }
 for (const value of ['K7', 'R066', 'R067', 'R071']) {
  assert.throws(() => resolveRoom('K', value), /not found/);
 }
});
test('printed upper K5 is bounded while legacy R069 resolves to it and lower K6 stays selectable', async () => {
 const k5 = resolveRoom('K', 'K5');
 const k6 = resolveRoom('K', 'K6');
 assert.equal(k5.id, 'R068');
 assert.deepEqual(k5.polygon, [[660,394],[681,394],[681,425],[660,425]]);
 assert.equal(k6.id, 'R070');
 const matches = rooms.filter(room => room.label === 'K6');
 assert.equal(matches.length, 1);
 assert.equal(resolveRoom('K', 'K6 (lower map location)').id, k6.id);
 assert.equal(resolveRoom('K', 'K6 (R070)').id, k6.id);
 for (const legacy of ['R069', 'K6 (R069)', 'K6 (upper map location)']) {
  assert.equal(resolveRoom('K', legacy).id, k5.id);
 }
 assert.equal(evacuationForRoom(k5).reference_label, 'K-1-K5');
 assert.equal(evacuationForRoom(k6).reference_label, 'K6-K13');
 const dir = await mkdtemp(join(tmpdir(),'gunnmap-merged-k5-'));
 try {
  const [width,height] = roomData.image_size;
  const baseImage = join(dir,'blank.png');
  await sharp({create:{width,height,channels:3,background:'#ffffff'}}).png().toFile(baseImage);
  const image = await renderRooms({'R069':'#ff0000'},{opacity:1,baseImage});
  const {data,info} = await sharp(image).raw().toBuffer({resolveWithObject:true});
  const pixel = (x:number,y:number) => Array.from(data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3));
  assert.deepEqual(pixel(675,400),[255,0,0]);
  assert.deepEqual(pixel(675,430),[255,255,255]);
 } finally { await rm(dir,{recursive:true,force:true}); }
 assert.throws(() => resolveRoom('M', 'R148'), /not in/);
});
test('shared rooms render every period color in clipped horizontal and vertical strips',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gunnmap-colors-'));
 try {
  const [width,height]=roomData.image_size, baseImage=join(dir,'blank.png');
  await sharp({create:{width,height,channels:3,background:'#ffffff'}}).png().toFile(baseImage);
  const image=await renderRooms({A134:['#ff0000','#00ff00','#0000ff'],J1:['#ff0000','#00ff00','#0000ff']},{opacity:1,baseImage});
  const {data,info}=await sharp(image).raw().toBuffer({resolveWithObject:true});
  const pixel=(x:number,y:number)=>Array.from(data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3));
  assert.deepEqual(pixel(691,920),[255,0,0]);
  assert.deepEqual(pixel(716,920),[0,255,0]);
  assert.deepEqual(pixel(741,920),[0,0,255]);
  assert.deepEqual(pixel(440,331),[255,0,0]);
  assert.deepEqual(pixel(440,348),[0,255,0]);
  assert.deepEqual(pixel(440,365),[0,0,255]);
  assert.deepEqual(pixel(756,930),[255,255,255]);
  assert.deepEqual(pixel(440,379),[255,255,255]);
  await assert.rejects(renderRooms({A134:[]}),/at least one color/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('downloaded PNG includes all seven legend swatches without changing map coordinates',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gunnmap-legend-'));
 try {
  const palette=['#ff0000','#00ff00','#0000ff','#ffaa00','#00aaff','#ff00ff','#112233'];
  const result=await renderPeriods(palette.map(color=>({building:'N',room:'n214',color})),dir);
  const {data,info}=await sharp(await readFile(join(dir,result.image_url.split('/').pop()!))).raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([info.width,info.height],roomData.image_size);
  assert.equal(result.selected.length, 7);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0],/Periods 1, 2, 3, 4, 5, 6, 7.*split/);
  const pixel=(x:number,y:number)=>Array.from(data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3));
  for(let i=0;i<7;i++) {
   assert.deepEqual(pixel(455,1313+i*34),palette[i].slice(1).match(/../g)!.map(hex=>parseInt(hex,16)));
   assert.deepEqual(result.selected[i].marker,[1651.5,576.5]);
   assert.deepEqual(result.selected[i].polygon,resolveRoom('N','N214').polygon);
   assert.equal(result.selected[i].evacuation.group,'black');
   assert.equal(result.selected[i].evacuation.reference_label,'N201-N217');
   assert.equal(result.selected[i].floor,2);
  }
  // Check rasterized title and row text, not just the color swatches.
  for(const [left,top,width,height] of [[444,1256,250,34],[478,1298,330,30]]) {
   let dark=0;
   for(let y=top;y<top+height;y++) for(let x=left;x<left+width;x++) if(pixel(x,y).every(value=>value<160)) dark++;
   assert.ok(dark>100,'legend text should be readable in the PNG');
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('HTTP rendering, pixels, isolated images, validation and static routes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gunnmap-ts-')),server=createApp(dir);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address = server.address();
 assert.ok(address && typeof address === 'object');
 const base = `http://127.0.0.1:${address.port}`;
 const post = (body: unknown) => fetch(`${base}/api/render`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
 });
 try {
  const inventory = await (await fetch(`${base}/api/rooms`)).json();
  assert.equal(inventory.rooms.length, rooms.length);
  const reference = await (await fetch(`${base}/api/evacuation-data`)).json();
  assert.equal(reference.routesAvailable, true);
  assert.equal(reference.provenance.sourceKind, 'supplied_reference');
  assert.equal(reference.provenance.sourceRevisionDate, null);
  assert.equal(reference.provenance.verifiedOn, null);
  assert.deepEqual(reference.validationIssues, []);
  const referenceImage = Buffer.from(await (await fetch(`${base}/evacuation-map.png`)).arrayBuffer());
  assert.deepEqual(referenceImage, await readFile(join(ROOT, 'src/map/gunn_evacuation_map.png')));
  const referenceMetadata = await sharp(referenceImage).metadata();
  assert.deepEqual([referenceMetadata.width, referenceMetadata.height], [1852, 1156]);
  for (const [query, group] of [['H1', 'red'], ['M3', 'blue'], ['K6', 'green'], ['N214', 'black'], ['E02', null], ['N223', null]]) {
   const lookup = await (await fetch(`${base}/api/room-lookup?q=${query}`)).json();
   assert.equal(lookup.rooms[0].evacuation.group, group, query ?? '');
   if (group) assert.match(lookup.rooms[0].evacuation.destination, /^Historical reference:/);
   else assert.equal(lookup.rooms[0].evacuation.focus, null);
  }
  const response = await post({ periods: periods('ｎ', 'n214') });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const first = await response.json();
  assert.equal(first.selected[0].evacuation.group, 'black');
  assert.equal(first.selected[0].evacuation.reference_label, 'N201-N217');
  assert.match(first.selected[0].evacuation.note, /unverified older/);
  assert.equal(first.selected[0].building, 'N');
  assert.deepEqual(first.selected[0].marker, [1651.5, 576.5]);
  const imageResponse = await fetch(base + first.image_url);
  assert.equal(imageResponse.headers.get('cache-control'), 'no-store');
  assert.equal(imageResponse.headers.get('etag'), null);
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], roomData.image_size);
  const before = await sharp(join(ROOT, roomData.base_image))
   .removeAlpha()
   .raw()
   .toBuffer();
  const after = await sharp(bytes).removeAlpha().raw().toBuffer();
  assert.deepEqual(after.subarray(0, 300), before.subarray(0, 300));
  assert.notDeepEqual(after, before);
  const second = await renderPeriods(periods('M', 'M3'), dir);
  assert.notEqual(first.image_url, second.image_url);
  assert.deepEqual(Buffer.from(await (await fetch(base+first.image_url)).arrayBuffer()),bytes);
  await assert.rejects(readFile(join(dir, 'period_map.png')), { code: 'ENOENT' });
  assert.deepEqual((await readdir(dir)).sort(), [first.image_url.split('/').pop(), second.image_url.split('/').pop()].sort());
  assert.equal((await fetch(base + '/output/period_map.png')).status, 404);
  const duplicatePeriods = periods('N', 'N214', '#0000ff');
  duplicatePeriods[1] = { building: 'N', room: 'N214', color: '#ff0000' };
  const result = await renderPeriods(duplicatePeriods, dir);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0],/split into each period's color/);
  const shared=await sharp(await readFile(join(dir,result.image_url.split('/').pop()!))).removeAlpha().raw().toBuffer();
  const left=(580*roomData.image_size[0]+1640)*3,right=(580*roomData.image_size[0]+1665)*3;
  assert.ok(shared[left+2]>shared[left]+100,'first period remains blue');
  assert.ok(shared[right]>shared[right+2]+100,'second period remains red');
  const invalidBodies = [
   null,
   [],
   {},
   { periods: [] },
   { periods: [null, ...Array(6).fill({})] },
   { periods: periods('N', 'N214', 'red') },
   { periods: periods('M', 'N214') },
  ];
  for (const body of invalidBodies) {
   assert.equal((await post(body)).status, 400);
  }
  assert.equal((await fetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await fetch(base+'/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(16001)})).status,400);
  const staticPaths = [
   '/',
   '/main.js',
   '/style.css',
   '/evacuation',
   '/find-room',
   '/generate-map',
   '/evacuation-map.png',
   '/map.png',
   '/manifest.webmanifest',
   '/icon.svg',
   '/apple-touch-icon.png',
   '/pwa-icon-192.png',
   '/pwa-icon-512.png',
   '/assets/campus-map.svg',
   '/assets/evacuation-routes.svg',
  ];
  for (const path of staticPaths) {
   assert.equal((await fetch(base + path)).status, 200, path);
  }
  const manifestResponse = await fetch(base + '/manifest.webmanifest');
  assert.match(
   manifestResponse.headers.get('content-type') ?? '',
   /^application\/manifest\+json/,
  );
  assert.equal((await manifestResponse.json()).display, 'standalone');
  const script=await fetch(`${base}/main.js`);
  assert.match(script.headers.get('content-type')??'',/^text\/javascript/);
  assert.equal(await script.text(),await readFile(join(ROOT,'dist','web','main.js'),'utf8'));
  for (const route of ['/', '/evacuation', '/find-room', '/generate-map']) {
   const page=await (await fetch(base+route)).text();
   assert.match(page,/<div id="root"><\/div>/);
   assert.match(page,/<script type="module" src="\/main\.js"><\/script>/);
  }
  const invalidOutputPaths = [
   '/output/../room_regions.json',
   '/output/period_map_bad.png',
   `/output/period_map_${'a'.repeat(32)}.png`,
  ];
  for (const path of invalidOutputPaths) {
   assert.equal((await fetch(base + path)).status, 404, path);
  }
 } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(dir,{recursive:true,force:true});}
});
