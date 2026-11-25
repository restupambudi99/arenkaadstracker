export async function pdfText(file: File): Promise<string> {
  if (file.size>8*1024*1024) throw new Error('PDF maksimal 8 MB.');
  const [{getDocument,GlobalWorkerOptions},{default:workerUrl}]=await Promise.all([import('pdfjs-dist'),import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  GlobalWorkerOptions.workerSrc=workerUrl;
  const task=getDocument({data:await file.arrayBuffer()});
  try {
    const document=await task.promise;
    if(document.numPages>500)throw new Error('PDF maksimal 500 halaman.');
    const pages:string[]=[];let length=0;
    for(let n=1;n<=document.numPages;n++) {
      const content=await (await document.getPage(n)).getTextContent();
      const text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('');
      length+=text.length;
      if(length>500000)throw new Error('Hasil ekstraksi maksimal 500.000 karakter.');
      pages.push(text);
    }
    const result=pages.join('\n\n').trim();
    if(!result)throw new Error('PDF tidak berisi teks. Gunakan PDF teks; OCR belum tersedia.');
    return result;
  } finally {await task.destroy();}
}
