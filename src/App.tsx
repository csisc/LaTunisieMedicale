/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Search, Loader2, ExternalLink } from 'lucide-react';

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
  const [searchMode, setSearchMode] = useState<'toc' | 'search'>('toc');
  const [titleQuery, setTitleQuery] = useState('');
  const [authorQuery, setAuthorQuery] = useState('');
  const [volume, setVolume] = useState('102');
  const [issue, setIssue] = useState('2');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [articles, setArticles] = useState<ArticleData[]>([]);

  const fetchArticles = async () => {
    if (searchMode === 'toc') {
      if (!volume) {
        setError('Please provide a volume.');
        return;
      }
    } else {
      if (!titleQuery && !authorQuery) {
        setError('Please provide at least a title keyword or an author name.');
        return;
      }
    }

    setLoading(true);
    setError(null);
    setArticles([]);

    try {
      let sparqlQuery = '';
      if (searchMode === 'toc') {
        const issueClause = issue ? `?article wdt:P433 "${issue}" .` : '';
        sparqlQuery = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>

SELECT DISTINCT ?article WHERE {
  ?article wdt:P1433 wd:Q3213360 .
  ?article wdt:P478 "${volume}" .
  ${issueClause}
} LIMIT 500
        `.trim();
      } else {
        const titleRegex = titleQuery ? `FILTER(REGEX(?title, "${titleQuery.replace(/"/g, '\\\\"')}", "i"))` : '';
        const titlePattern = titleQuery ? `?article rdfs:label ?title .\n    ${titleRegex}` : '';

        const authorRegex = authorQuery ? `FILTER(REGEX(?authorName, "${authorQuery.replace(/"/g, '\\\\"')}", "i"))` : '';
        const authorStrRegex = authorQuery ? `FILTER(REGEX(?authorNameStr, "${authorQuery.replace(/"/g, '\\\\"')}", "i"))` : '';

        if (authorQuery) {
          sparqlQuery = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?article WHERE {
  {
    ?article wdt:P1433 wd:Q3213360 .
    ${titlePattern}
    ?article wdt:P50 ?authorItem .
    ?authorItem rdfs:label ?authorName .
    ${authorRegex}
  } UNION {
    ?article wdt:P1433 wd:Q3213360 .
    ${titlePattern}
    ?article wdt:P2093 ?authorNameStr .
    ${authorStrRegex}
  }
} LIMIT 500
          `.trim();
        } else {
          sparqlQuery = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?article WHERE {
  ?article wdt:P1433 wd:Q3213360 .
  ${titlePattern}
} LIMIT 500
          `.trim();
        }
      }
      
      const qleverUrl = `https://qlever.cs.uni-freiburg.de/api/wikidata?query=${encodeURIComponent(sparqlQuery)}`;
      const qleverRes = await fetch(qleverUrl, {
        headers: { 'Accept': 'application/sparql-results+json' }
      });

      if (!qleverRes.ok) {
        let errorMsg = 'Failed to fetch from QLever query service.';
        try {
          const errorData = await qleverRes.text();
          if (errorData) errorMsg += ` Details: ${errorData.substring(0, 100)}`;
        } catch (e) {
          // ignore
        }
        throw new Error(errorMsg);
      }

      const qleverData = await qleverRes.json();
      const bindings = qleverData.results?.bindings || [];
      
      if (bindings.length === 0) {
        if (searchMode === 'toc') {
          setError(issue ? `No articles found for Volume ${volume}, Issue ${issue}.` : `No articles found for Volume ${volume}.`);
        } else {
          setError('No articles found matching your search criteria.');
        }
        setLoading(false);
        return;
      }

      const articleIds = bindings.map((b: any) => {
        const uri = b.article.value;
        return uri.substring(uri.lastIndexOf('/') + 1);
      });

      // Step 2: Fetch full entity data from Wikidata API in batches of 50
      const fetchedArticles: any[] = [];
      const batchSize = 50;
      const allAuthorQids = new Set<string>();
      
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

            // Collect linked authors QIDs
            const authorQids: string[] = [];
            if (claims.P50) {
              claims.P50.forEach((claim: any) => {
                const qid = claim.mainsnak?.datavalue?.value?.id;
                if (qid) {
                   authorQids.push(qid);
                   allAuthorQids.add(qid);
                }
              });
            }
            
            fetchedArticles.push({
              id,
              title,
              authors,
              authorQids,
              pages,
              doi,
              pubDate,
              url
            });
          }
        }
      }

      // Step 3: Fetch author labels
      const authorLabels: Record<string, string> = {};
      if (allAuthorQids.size > 0) {
        const authorIdsArray = Array.from(allAuthorQids);
        for (let i = 0; i < authorIdsArray.length; i += 50) {
          const batchIds = authorIdsArray.slice(i, i + 50);
          const wbUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batchIds.join('|')}&format=json&props=labels&origin=*`;
          const wbRes = await fetch(wbUrl);
          if (wbRes.ok) {
            const wbData = await wbRes.json();
            if (wbData.entities) {
              for (const [aId, aEntity] of Object.entries<any>(wbData.entities)) {
                authorLabels[aId] = aEntity.labels?.en?.value || aEntity.labels?.fr?.value || aEntity.labels?.ar?.value || aId;
              }
            }
          }
        }
      }

      // Step 4: Resolve author QIDs to labels
      const finalArticles: ArticleData[] = fetchedArticles.map(article => {
        const resolvedAuthors = [...article.authors];
        if (article.authorQids) {
          article.authorQids.forEach((qid: string) => {
            resolvedAuthors.push(authorLabels[qid] || qid);
          });
        }
        return {
          id: article.id,
          title: article.title,
          authors: resolvedAuthors,
          pages: article.pages,
          doi: article.doi,
          pubDate: article.pubDate,
          url: article.url
        };
      });

      // Sort by pages if possible
      finalArticles.sort((a, b) => {
        const aPage = parseInt(a.pages.split('-')[0]) || 0;
        const bPage = parseInt(b.pages.split('-')[0]) || 0;
        return aPage - bPage;
      });

      setArticles(finalArticles);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred fetching the data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch on mount
    fetchArticles();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        <header className="mb-10 text-center">
          <img src="https://raw.githubusercontent.com/csisc/LaTunisieMedicale/refs/heads/main/img/tunismed.png" alt="La Tunisie Médicale" className="h-24 w-auto mx-auto mb-4 object-contain" />
          <h1 className="text-4xl font-semibold tracking-tight mb-2">La Tunisie Médicale</h1>
          <p className="text-slate-500 mb-8 font-medium">Article Explorer via Wikidata</p>
          
          <div className="flex justify-center mb-6">
            <div className="bg-slate-200 p-1 rounded-xl inline-flex">
              <button 
                onClick={() => setSearchMode('toc')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${searchMode === 'toc' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Table of Contents
              </button>
              <button 
                onClick={() => setSearchMode('search')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${searchMode === 'search' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Search by Keyword
              </button>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 inline-flex flex-wrap items-center justify-center gap-4 max-w-full">
            {searchMode === 'toc' ? (
              <>
                <div className="flex items-center gap-2">
                  <label htmlFor="volume" className="text-sm font-semibold text-slate-700">Volume</label>
                  <input 
                    id="volume"
                    type="text" 
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchArticles()}
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
                    onKeyDown={(e) => e.key === 'Enter' && fetchArticles()}
                    className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-center"
                    placeholder="2"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <label htmlFor="titleQuery" className="text-sm font-semibold text-slate-700">Title Word</label>
                  <input 
                    id="titleQuery"
                    type="text" 
                    value={titleQuery}
                    onChange={(e) => setTitleQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchArticles()}
                    className="w-32 sm:w-48 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="e.g. cancer"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="authorQuery" className="text-sm font-semibold text-slate-700">Author</label>
                  <input 
                    id="authorQuery"
                    type="text" 
                    value={authorQuery}
                    onChange={(e) => setAuthorQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchArticles()}
                    className="w-32 sm:w-48 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="e.g. ben"
                  />
                </div>
              </>
            )}
            <button 
              onClick={fetchArticles}
              disabled={loading}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {searchMode === 'toc' ? 'Fetch TOC' : 'Search'}
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

      <footer className="mt-16 pb-8 text-center bg-transparent w-full">
        <p className="mb-4 text-xs font-semibold tracking-wider text-slate-500 uppercase">
          Powered by
        </p>
        <div className="flex justify-center items-center gap-6 sm:gap-10 flex-wrap opacity-80 hover:opacity-100 transition-opacity">
          <img
            src="https://raw.githubusercontent.com/csisc/LaTunisieMedicale/refs/heads/main/img/wikidata.png"
            alt="Wikidata"
            className="h-10 w-auto object-contain hover:scale-105 transition-transform"
          />
          <img
            src="https://raw.githubusercontent.com/csisc/LaTunisieMedicale/refs/heads/main/img/stsm.png"
            alt="Société Tunisienne des Sciences Médicales"
            className="h-10 w-auto object-contain hover:scale-105 transition-transform"
          />
          <img
            src="https://raw.githubusercontent.com/csisc/LaTunisieMedicale/refs/heads/main/img/ant.png"
            alt="Académie Nationale de Médecine"
            className="h-10 w-auto object-contain hover:scale-105 transition-transform"
          />
          <img
            src="https://raw.githubusercontent.com/csisc/LaTunisieMedicale/refs/heads/main/img/ais.png"
            alt="AI Studio"
            className="h-10 w-auto object-contain hover:scale-105 transition-transform"
          />
        </div>
      </footer>
    </div>
  );
}

