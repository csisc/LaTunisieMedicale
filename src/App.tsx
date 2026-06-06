/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Search, Loader2, BookOpen, ExternalLink } from 'lucide-react';

interface ArticleData {
  id: string;
  title: string;
  authors: string[];
  pages: string;
  doi: string;
  pubDate: string;
  url?: string;
}

export default function App() {
  const [volume, setVolume] = useState('102');
  const [issue, setIssue] = useState('2');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [articles, setArticles] = useState<ArticleData[]>([]);

  const fetchTOC = async () => {
    if (!volume) {
      setError('Please provide a volume.');
      return;
    }

    setLoading(true);
    setError(null);
    setArticles([]);

    try {
      // Step 1: Use QLever to find the article Wikidata IDs
      const issueClause = issue ? `?article wdt:P433 "${issue}" .` : '';
      const sparqlQuery = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>

SELECT ?article WHERE {
  ?article wdt:P1433 wd:Q3213360 .
  ?article wdt:P478 "${volume}" .
  ${issueClause}
} LIMIT 500
      `.trim();
      
      const qleverUrl = `https://qlever.dev/api/wikidata?query=${encodeURIComponent(sparqlQuery)}`;
      const qleverRes = await fetch(qleverUrl, {
        headers: { 'Accept': 'application/sparql-results+json' }
      });

      if (!qleverRes.ok) {
        throw new Error('Failed to fetch from QLever query service.');
      }

      const qleverData = await qleverRes.json();
      const bindings = qleverData.results?.bindings || [];
      
      if (bindings.length === 0) {
        setError(issue ? `No articles found for Volume ${volume}, Issue ${issue}.` : `No articles found for Volume ${volume}.`);
        setLoading(false);
        return;
      }

      const articleIds = bindings.map((b: any) => {
        const uri = b.article.value;
        return uri.substring(uri.lastIndexOf('/') + 1);
      });

      // Step 2: Fetch full entity data from Wikidata API in batches of 50
      const fetchedArticles: ArticleData[] = [];
      const batchSize = 50;
      
      for (let i = 0; i < articleIds.length; i += batchSize) {
        const batchIds = articleIds.slice(i, i + batchSize);
        const wbUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batchIds.join('|')}&format=json&props=labels|claims&origin=*`;
        
        const wbRes = await fetch(wbUrl);
        if (!wbRes.ok) {
          throw new Error('Failed to fetch entity data from Wikidata API.');
        }

        const wbData = await wbRes.json();
        
        if (wbData.entities) {
          for (const [id, entity] of Object.entries<any>(wbData.entities)) {
            const claims = entity.claims || {};
            
            // Title
            let title = entity.labels?.en?.value || entity.labels?.fr?.value || entity.labels?.ar?.value || `Unknown Title (${id})`;

            // Full work available at URL (P953)
            let url: string | undefined;
            if (claims.P953 && claims.P953[0]?.mainsnak?.datavalue?.value) {
              url = claims.P953[0].mainsnak.datavalue.value;
            }

            // DOI (P356)
            let doi = '';
            if (claims.P356 && claims.P356[0]?.mainsnak?.datavalue?.value) {
              doi = claims.P356[0].mainsnak.datavalue.value;
            }

            // Pages (P304)
            let pages = '';
            if (claims.P304 && claims.P304[0]?.mainsnak?.datavalue?.value) {
              pages = claims.P304[0].mainsnak.datavalue.value;
            }

            // Publication Date (P577)
            let pubDate = '';
            if (claims.P577 && claims.P577[0]?.mainsnak?.datavalue?.value?.time) {
              const timeStr = claims.P577[0].mainsnak.datavalue.value.time;
              // format: +YYYY-MM-DD...
              pubDate = timeStr.replace(/^[+-]/, '').split('T')[0]; 
            }

            // Authors (P2093 author name string, P50 author item)
            const authors: string[] = [];
            
            // Collect author name strings
            if (claims.P2093) {
              claims.P2093.forEach((claim: any) => {
                if (claim.mainsnak?.datavalue?.value) {
                  authors.push(claim.mainsnak.datavalue.value);
                }
              });
            }

            // Collect linked authors
            // In a complete implementation we would batch fetch the author item labels, 
            // but for simplicity we will just show their QIDs or assume P2093 is populated.
            // Often Wikidata creates P2093 or P50 + rdfs:label. 
            // We'll add QIDs if P50 exists.
            if (claims.P50) {
              claims.P50.forEach((claim: any) => {
                if (claim.mainsnak?.datavalue?.value?.id) {
                   // A more advanced app would fetch these P50 QIDs iteratively.
                   authors.push(claim.mainsnak.datavalue.value.id);
                }
              });
            }
            
            fetchedArticles.push({
              id,
              title,
              authors,
              pages,
              doi,
              pubDate,
              url
            });
          }
        }
      }

      // Sort by pages if possible
      fetchedArticles.sort((a, b) => {
        const aPage = parseInt(a.pages.split('-')[0]) || 0;
        const bPage = parseInt(b.pages.split('-')[0]) || 0;
        return aPage - bPage;
      });

      setArticles(fetchedArticles);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred fetching the data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch on mount
    fetchTOC();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        <header className="mb-10 text-center">
          <div align="center">
            <img src="https://raw.githubusercontent.com/csisc/LaTunisieMedicale/refs/heads/main/img/tunismed.png" />
            <br />
          </div>
          <h1 className="text-4xl font-semibold tracking-tight mb-2">La Tunisie Médicale</h1>
          <p className="text-slate-500 mb-8 font-medium">User-friendly web interface for the journal's open archives</p>
          <div style="text-align: center; padding: 16px;">
  <p style="margin: 0 0 12px; font-weight: 600; font-size: 14px; letter-spacing: 0.5px; color: #555;">
    Powered by
  </p>

  <div style="display: flex; justify-content: center; align-items: center; gap: 20px; flex-wrap: wrap;">
    <img
      src="https://raw.githubusercontent.com/csisc/LaTunisieMedicale/refs/heads/main/img/wikidata.png"
      alt="Wikidata"
      style="height: 40px; width: auto; object-fit: contain;"
    />
    <img
      src="https://raw.githubusercontent.com/csisc/LaTunisieMedicale/refs/heads/main/img/stsm.png"
      alt="STSM"
      style="height: 40px; width: auto; object-fit: contain;"
    />
    <img
      src="https://raw.githubusercontent.com/csisc/LaTunisieMedicale/refs/heads/main/img/ant.png"
      alt="ANT"
      style="height: 40px; width: auto; object-fit: contain;"
    />
  </div>
</div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 inline-flex flex-wrap items-center justify-center gap-4 max-w-full">
            <div className="flex items-center gap-2">
              <label htmlFor="volume" className="text-sm font-semibold text-slate-700">Volume</label>
              <input 
                id="volume"
                type="text" 
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                className="w-20 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-center"
                placeholder="102"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="issue" className="text-sm font-semibold text-slate-700">Issue (Optional)</label>
              <input 
                id="issue"
                type="text" 
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-center"
                placeholder="2"
              />
            </div>
            <button 
              onClick={fetchTOC}
              disabled={loading}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Fetch TOC
            </button>
          </div>
        </header>

        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-xl mb-8 text-center border border-red-100">
            {error}
          </div>
        )}

        {!loading && articles.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Pages</th>
                    <th className="px-6 py-4 font-semibold">Article</th>
                    <th className="px-6 py-4 font-semibold">Date</th>
                    <th className="px-6 py-4 font-semibold text-right">Links</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {articles.map((article) => (
                    <tr key={article.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap font-mono text-slate-500">
                        {article.pages || '-'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900 mb-1 leading-snug">
                          {article.url ? (
                            <a href={article.url} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">
                              {article.title}
                            </a>
                          ) : (
                            article.title
                          )}
                        </div>
                        {article.authors.length > 0 && (
                          <div className="text-slate-500 text-xs">
                            {article.authors.join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                        {article.pubDate || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-3">
                          {article.doi && (
                            <a 
                              href={`https://doi.org/${article.doi}`} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1 text-xs"
                            >
                              DOI <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          <a 
                            href={`https://www.wikidata.org/wiki/${article.id}`} 
                            target="_blank" 
                            rel="noreferrer"
                            className="text-slate-400 hover:text-slate-600 inline-flex items-center gap-1 text-xs"
                          >
                            {article.id} <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

